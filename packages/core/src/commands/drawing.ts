// Drawing walls the way a person does. Ends snap onto nearby corners and walls; a wall that
// ends on another wall or crosses it splits that wall there, so each room keeps its own
// wall to paint; stretches an existing wall already covers are not drawn twice; and areas
// the new wall closes off become rooms. `addWall` stays as the exact, literal command for
// importers.
import { z } from 'zod';
import { EditError } from '../errors.ts';
import { cross, distance, dot, lerp, pointSegmentDistance, sub, wallDirection, wallLength } from '../geometry.ts';
import { JOIN_TOLERANCE } from '../joins.ts';
import { MIN_WALL_LENGTH } from '../rules.ts';
import { IdSchema, type Vec2, type Wall } from '../schema.ts';
import { DEFAULT_CONNECT, snapToWalls } from '../snap.ts';
import { axisHit, findRooms, joinCandidate, OPEN_END_REACH, outlineOverlap, sameOutline } from '../topology.ts';
import { defineCommand, find, levelFor, type Draft } from './edit.ts';
import { keepRoomsOnWalls } from './follow.ts';
import { Length } from './inputs.ts';
import { AddWallInput, insertWall, moveWallCorner, splitWallAt } from './walls.ts';

/** Walls closer to parallel than this (sine of the angle) count as lying along each other. */
const PARALLEL = 1e-6;
/** A wall this close to another wall's line lies on it. */
const ON_LINE = 1e-3;

const fmt = (v: number) => `${(Math.round(v * 1000) / 1000).toString()} m`;

export const drawWall = defineCommand(
  AddWallInput.omit({ id: true }).extend({
    /** join ends onto corners and walls within this distance; 0 places them exactly */
    snap: z.number().finite().nonnegative().max(1).optional(),
    /** turn areas the new wall closes off into rooms (default true) */
    rooms: z.boolean().optional(),
  }),
  (d, { snap, rooms, ...input }) => {
    keepRoomsOnWalls(d, { create: rooms ?? true }, () => {
      const home = d.home;
      const level = levelFor(home, input.level);
      const walls = home.walls.filter((w) => w.level === level);
      const radius = snap ?? DEFAULT_CONNECT;
      const hosts = new Map<string, Vec2[]>();
      const addSplit = (wall: Wall, p: Vec2) => hosts.set(wall.id, [...(hosts.get(wall.id) ?? []), p]);

      const ends = (['start', 'end'] as const).map((which) => {
        const s = snapToWalls(walls, input[which], radius);
        if (s.kind === 'corner') d.notes.push(`The ${which} joins the corner of ${s.walls.join(' and ')}.`);
        if (s.host && s.along !== undefined) {
          const len = wallLength(s.host);
          if (s.along > JOIN_TOLERANCE && s.along < len - JOIN_TOLERANCE) {
            addSplit(s.host, s.point);
            d.notes.push(`The ${which} meets wall "${s.host.id}" ${fmt(s.along)} along it.`);
          }
        }
        return s.point;
      });
      const [a, b] = ends as [Vec2, Vec2];
      const length = distance(a, b);
      if (length < MIN_WALL_LENGTH) {
        throw new EditError('wall_too_short', `After snapping, the wall would be ${fmt(length)} long. Draw it at least ${fmt(MIN_WALL_LENGTH)} long.`, { length });
      }

      const pieces = uncovered(walls, a, b);
      if (pieces.length === 0) {
        const by = coveringWalls(walls, a, b).join(', ');
        throw new EditError('wall_exists', `A wall already runs the whole way from [${a.join(', ')}] to [${b.join(', ')}] (${by}).`, { walls: coveringWalls(walls, a, b) });
      }
      const skipped = length - pieces.reduce((s, [p0, p1]) => s + (p1 - p0), 0);
      if (skipped > MIN_WALL_LENGTH) d.notes.push(`Left out ${fmt(skipped)} that ${coveringWalls(walls, a, b).join(', ')} already cover${coveringWalls(walls, a, b).length === 1 ? 's' : ''}.`);

      const dir = wallDirection({ start: a, end: b });
      const at = (t: number): Vec2 => [a[0] + dir[0] * t, a[1] + dir[1] * t];
      const segments: Array<[number, number]> = [];
      for (const [p0, p1] of pieces) {
        const cuts = new Set<number>();
        for (const w of walls) {
          const cut = meetsAt(w, at(p0), at(p1));
          if (!cut) continue;
          const t = p0 + cut.along;
          if (t <= p0 + JOIN_TOLERANCE || t >= p1 - JOIN_TOLERANCE) continue;
          cuts.add(t);
          if (cut.host) {
            addSplit(w, at(t));
            d.notes.push(`Crosses wall "${w.id}"; both are split there.`);
          }
        }
        const stops = [p0, ...[...cuts].sort((x, y) => x - y), p1];
        for (let i = 0; i + 1 < stops.length; i++) segments.push([stops[i]!, stops[i + 1]!]);
      }
      for (const [t0, t1] of segments) {
        if (t1 - t0 < MIN_WALL_LENGTH) {
          throw new EditError('wall_too_short', `The new wall would leave a piece ${fmt(t1 - t0)} long at [${at(t0).join(', ')}]. Move its end so walls don't meet that close together.`, {
            length: t1 - t0,
          });
        }
      }

      for (const [id, points] of hosts) splitAtPoints(d, find(home, 'walls', id), points);
      const ids = segments.map(([t0, t1]) => insertWall(d, { ...input, level, start: at(t0), end: at(t1) }));
      if (ids.length > 1) d.notes.push(`Drawn as ${ids.length} walls: ${ids.join(', ')}.`);
    });
  },
);

/** Stretches of a→b (as distances from a) that no wall along the same line covers. */
function uncovered(walls: readonly Wall[], a: Vec2, b: Vec2): Array<[number, number]> {
  const length = distance(a, b);
  const covered = coveredStretches(walls, a, b)
    .map((c) => c.range)
    .sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  let t = 0;
  for (const [c0, c1] of covered) {
    if (c0 - t >= MIN_WALL_LENGTH) out.push([t, c0]);
    t = Math.max(t, c1);
  }
  if (length - t >= MIN_WALL_LENGTH) out.push([t, length]);
  return out;
}

function coveredStretches(walls: readonly Wall[], a: Vec2, b: Vec2): Array<{ wall: string; range: [number, number] }> {
  const dir = wallDirection({ start: a, end: b });
  const length = distance(a, b);
  const out: Array<{ wall: string; range: [number, number] }> = [];
  for (const w of walls) {
    if (Math.abs(cross(dir, wallDirection(w))) > PARALLEL) continue;
    if (Math.abs(cross(dir, sub(w.start, a))) > ON_LINE) continue;
    const s = dot(sub(w.start, a), dir);
    const e = dot(sub(w.end, a), dir);
    const range: [number, number] = [Math.max(0, Math.min(s, e)), Math.min(length, Math.max(s, e))];
    if (range[1] - range[0] > MIN_WALL_LENGTH) out.push({ wall: w.id, range });
  }
  return out;
}

function coveringWalls(walls: readonly Wall[], a: Vec2, b: Vec2): string[] {
  return coveredStretches(walls, a, b).map((c) => c.wall);
}

/** Where wall `w` meets the stretch p→q away from the stretch's ends: crossing it (`host`:
 *  w must be split too), or ending on it. */
function meetsAt(w: Wall, p: Vec2, q: Vec2): { along: number; host: boolean } | null {
  const dir = wallDirection({ start: p, end: q });
  const len = distance(p, q);
  for (const end of [w.start, w.end]) {
    if (pointSegmentDistance(end, p, q) <= JOIN_TOLERANCE) return { along: dot(sub(end, p), dir), host: false };
  }
  const dw = wallDirection(w);
  const det = cross(dir, dw);
  if (Math.abs(det) < PARALLEL) return null;
  const rel = sub(w.start, p);
  const s = cross(rel, dw) / det;
  const u = cross(rel, dir) / det;
  const wl = wallLength(w);
  if (s <= 0 || s >= len || u <= JOIN_TOLERANCE || u >= wl - JOIN_TOLERANCE) return null;
  return { along: s, host: true };
}

// ---------- splitting and merging ----------

/** Split a wall at several points along it. The first piece keeps the wall's id. */
function splitAtPoints(d: Draft, wall: Wall, points: Vec2[]): void {
  const alongs = points.map((p) => dot(sub(p, wall.start), wallDirection(wall))).sort((x, y) => y - x);
  for (const t of alongs) splitWallAt(d, wall, t);
}

export const splitWall = defineCommand(
  z.strictObject({
    id: IdSchema,
    /** distance from the wall's start */
    at: Length,
  }),
  (d, input) => {
    const wall = find(d.home, 'walls', input.id);
    const tail = splitWallAt(d, wall, input.at);
    d.notes.push(`Split wall "${wall.id}" into "${wall.id}" and "${tail}".`);
  },
);

/** Join two walls that continue each other in a straight line into one. */
export const mergeWalls = defineCommand(z.strictObject({ ids: z.tuple([IdSchema, IdSchema]) }), (d, { ids }) => {
  keepRoomsOnWalls(d, { create: false }, () => {
    const home = d.home;
    const a = find(home, 'walls', ids[0]);
    const b = find(home, 'walls', ids[1]);
    const refuse = (why: string) => {
      throw new EditError('cannot_merge', `Walls "${a.id}" and "${b.id}" can't be joined into one: ${why}.`, { ids });
    };
    if (a.level !== b.level) refuse('they are on different levels');
    const da = wallDirection(a);
    const db = wallDirection(b);
    if (Math.abs(cross(da, db)) > PARALLEL) refuse('they are not in a straight line');
    const joint = sharedEnd(a, b);
    if (!joint) refuse('they don’t share an end');
    const { aEnd, bEnd } = joint!;
    const sameWay = dot(da, db) > 0;
    if ((aEnd === bEnd) === sameWay) refuse('they overlap instead of continuing each other');

    // Compare b as if it ran the same way as a.
    const flip = <T extends string>(side: T): T => (sameWay ? side : ((side === 'left' ? 'right' : side === 'right' ? 'left' : side) as T));
    if (Math.abs(a.thickness - b.thickness) > 1e-9) refuse(`one is ${fmt(a.thickness)} thick and the other ${fmt(b.thickness)}`);
    if ((a.height ?? null) !== (b.height ?? null)) refuse('their heights differ');
    if (a.line !== flip(b.line)) refuse('their lines are on different faces');
    const bLeft = sameWay ? b.materials.left : b.materials.right;
    const bRight = sameWay ? b.materials.right : b.materials.left;
    if (a.materials.left !== bLeft || a.materials.right !== bRight) refuse('their faces have different finishes');
    const jointPoint = a[aEnd];
    const others = home.walls.filter((w) => w !== a && w !== b && w.level === a.level && (distance(w.start, jointPoint) <= JOIN_TOLERANCE || distance(w.end, jointPoint) <= JOIN_TOLERANCE));
    if (others.length) refuse(`${others.map((w) => `"${w.id}"`).join(', ')} meet${others.length === 1 ? 's' : ''} them at the joint`);

    const bFar = bEnd === 'start' ? 'end' : 'start';
    const lenA = wallLength(a);
    const lenB = wallLength(b);
    // Openings are measured along the merged wall, which runs the way `a` does.
    if (aEnd === 'start') for (const o of home.openings) if (o.wall === a.id) o.offset += lenB;
    for (const o of home.openings) {
      if (o.wall !== b.id) continue;
      const nearEdge = sameWay ? o.offset : lenB - o.offset - o.width;
      o.wall = a.id;
      o.offset = aEnd === 'end' ? lenA + nearEdge : nearEdge;
    }
    // The merged wall's new end is b's far end, with that end's source.
    const farSource = b.sources?.[bFar] ?? b.source;
    a[aEnd] = b[bFar];
    if (farSource) a.sources = { ...a.sources, [aEnd]: { ...farSource } };
    home.walls = home.walls.filter((w) => w !== b);
    d.notes.push(`Joined "${b.id}" into "${a.id}".`);
  });
});

function sharedEnd(a: Wall, b: Wall): { aEnd: 'start' | 'end'; bEnd: 'start' | 'end' } | null {
  for (const aEnd of ['start', 'end'] as const) {
    for (const bEnd of ['start', 'end'] as const) {
      if (distance(a[aEnd], b[bEnd]) <= JOIN_TOLERANCE) return { aEnd, bEnd };
    }
  }
  return null;
}

// ---------- loose ends ----------

/** Close a gap: carry a loose wall end on to the wall its line reaches, or meet another
 *  loose end at the corner their lines make. */
export const joinWallEnd = defineCommand(
  z.strictObject({
    id: IdSchema,
    end: z.enum(['start', 'end']),
    /** the wall to join; leave out for the nearest one within 0.5 m */
    to: IdSchema.optional(),
  }),
  (d, input) => {
    keepRoomsOnWalls(d, { create: true }, () => {
      const home = d.home;
      const wall = find(home, 'walls', input.id);
      const target = input.to ? find(home, 'walls', input.to) : undefined;
      const candidate = target ? targetCandidate(wall, input.end, target) : joinCandidate(home, wall, input.end);
      if (!candidate) {
        const what = target ? `wall "${target.id}" (its line doesn't reach it within ${fmt(2 * OPEN_END_REACH)})` : `anything within ${fmt(OPEN_END_REACH)}`;
        throw new EditError('nothing_to_join', `The ${input.end} of wall "${wall.id}" has nothing to join: no ${what}.`, { id: wall.id, end: input.end });
      }
      const other = find(home, 'walls', candidate.wall);
      if (candidate.kind === 'wall') {
        moveWallCorner(home, wall, input.end, candidate.point, false);
        const along = dot(sub(candidate.point, other.start), wallDirection(other));
        if (along > JOIN_TOLERANCE && along < wallLength(other) - JOIN_TOLERANCE) splitWallAt(d, other, along);
        d.notes.push(`Carried the ${input.end} of "${wall.id}" ${fmt(candidate.gap)} on to wall "${other.id}".`);
        return;
      }
      const corner = cornerOf(wall, other);
      const reachable = corner && distance(corner, wall[input.end]) <= 2 * OPEN_END_REACH && distance(corner, other[candidate.end]) <= 2 * OPEN_END_REACH;
      const point = reachable ? corner : candidate.point;
      moveWallCorner(home, wall, input.end, point, false);
      if (reachable) moveWallCorner(home, other, candidate.end, point, false);
      d.notes.push(`Joined the ${input.end} of "${wall.id}" to the ${candidate.end} of "${other.id}" at [${point.map((v) => Math.round(v * 1000) / 1000).join(', ')}].`);
    });
  },
);

function targetCandidate(wall: Wall, which: 'start' | 'end', target: Wall) {
  const hit = axisHit([target], wall, which, { reach: 2 * OPEN_END_REACH });
  return hit ? { kind: 'wall' as const, wall: target.id, point: hit.point, gap: Math.abs(hit.gap) } : null;
}

/** Where two walls' lines cross. */
function cornerOf(a: Wall, b: Wall): Vec2 | null {
  const da = wallDirection(a);
  const db = wallDirection(b);
  const det = cross(da, db);
  if (Math.abs(det) < PARALLEL) return null;
  const s = cross(sub(b.start, a.start), db) / det;
  return lerp(a.start, a.end, s / wallLength(a));
}

// ---------- rooms from walls ----------

export const detectRooms = defineCommand(
  z.strictObject({
    level: IdSchema.optional(),
    /** also reshape rooms that nearly match an area (e.g. a scanned floor) to the walls */
    adopt: z.boolean().optional(),
  }),
  (d, input) => {
    const level = levelFor(d.home, input.level);
    if (input.adopt) {
      for (const area of findRooms(d.home, level)) {
        const room = d.home.rooms.find((r) => r.level === level && !sameOutline(r.polygon, area.polygon) && outlineOverlap(r.polygon, area.polygon) >= 0.8);
        if (!room) continue;
        room.polygon = area.polygon;
        d.notes.push(`Room "${room.name}" (${room.id}) now follows its walls.`);
      }
    }
    keepRoomsOnWalls(d, { create: true }, () => undefined);
  },
);
