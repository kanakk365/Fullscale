// Wall edits. Moving a wall end carries along the ends of walls that share that corner,
// and keeps doors and windows where they are in the room.
import { z } from 'zod';
import { EditError } from '../errors.ts';
import { add, distance, dot, leftOf, pointAlongWall, scale, wallDirection, wallLength } from '../geometry.ts';
import { allocateId, takeId } from '../ids.ts';
import { blockingProblem, CONNECTED, MIN_WALL_LENGTH, openingProblems, TOUCHING, wallLengthProblem } from '../rules.ts';
import { FieldSourcesSchema, IdSchema, SourceSchema, Vec2Schema, type Home, type Vec2, type Wall } from '../schema.ts';
import { JOIN_TOLERANCE } from '../joins.ts';
import { snapToWalls } from '../snap.ts';
import { distanceToWallBody } from '../topology.ts';
import { assignPatch, defineCommand, find, levelFor, mergeSources, type Draft } from './edit.ts';
import { keepRoomsOnWalls } from './follow.ts';
import { Length, SourcesInput } from './inputs.ts';

export const DEFAULT_WALL_THICKNESS = 0.12;

const m = (v: number) => `${Math.round(v * 1000) / 1000} m`;

const WallLine = z.enum(['center', 'left', 'right']);
const WallMaterials = z.strictObject({ left: IdSchema.optional(), right: IdSchema.optional() });

export const AddWallInput = z.strictObject({
  id: IdSchema.optional(),
  level: IdSchema.optional(),
  start: Vec2Schema,
  end: Vec2Schema,
  thickness: Length.optional(),
  /** leave out to follow the level's height */
  height: Length.optional(),
  line: WallLine.optional(),
  materials: WallMaterials.optional(),
  source: SourceSchema.optional(),
  sources: FieldSourcesSchema.optional(),
});

/** Add a wall on a draft and return its id. */
export function insertWall(d: Draft, input: z.output<typeof AddWallInput>): string {
  const home = d.home;
  const level = levelFor(home, input.level);
  const id = takeId(home, input.id, 'wall');
  const defaultPaint = home.materials.some((m) => m.id === 'paint-white') ? 'paint-white' : undefined;
  const wall: Wall = {
    id,
    level,
    start: input.start,
    end: input.end,
    thickness: input.thickness ?? DEFAULT_WALL_THICKNESS,
    line: input.line ?? 'center',
    materials: input.materials ?? (defaultPaint ? { left: defaultPaint, right: defaultPaint } : {}),
    source: input.source ?? { kind: d.ctx.by },
  };
  if (input.height !== undefined) wall.height = input.height;
  if (input.sources) wall.sources = input.sources;
  const problem = wallLengthProblem(wall);
  if (problem) throw problem;
  for (const m of Object.values(wall.materials)) if (m) find(home, 'materials', m);
  home.walls.push(wall);
  return id;
}

export const addWall = defineCommand(AddWallInput, (d, input) => {
  insertWall(d, input);
});

export const updateWall = defineCommand(
  z.strictObject({
    id: IdSchema,
    start: Vec2Schema.optional(),
    end: Vec2Schema.optional(),
    thickness: Length.optional(),
    /** null: follow the level's height again */
    height: Length.nullable().optional(),
    line: WallLine.optional(),
    /** merged into the current materials */
    materials: WallMaterials.optional(),
    source: SourceSchema.optional(),
    sources: SourcesInput.optional(),
  }),
  (d, { id, materials, sources, ...patch }) => {
    keepRoomsOnWalls(d, { create: false }, () => {
      const wall = find(d.home, 'walls', id);
      assignPatch(wall, patch);
      if (materials) {
        for (const m of Object.values(materials)) if (m) find(d.home, 'materials', m);
        wall.materials = { ...wall.materials, ...materials };
      }
      mergeSources(wall, sources);
      const problem = wallLengthProblem(wall);
      if (problem) throw problem;
      checkOpeningsOn(d.home, wall);
    });
  },
);

export const moveWallEnd = defineCommand(
  z.strictObject({
    id: IdSchema,
    end: z.enum(['start', 'end']),
    to: Vec2Schema,
    /** move only this wall, leaving walls that share the corner where they are */
    detach: z.boolean().optional(),
    /** join onto corners and walls within this distance; dropping the end on a wall splits
     *  it there. Leave out (or 0) to place the end exactly. */
    snap: z.number().finite().nonnegative().max(1).optional(),
  }),
  (d, input) => {
    keepRoomsOnWalls(d, { create: true }, () => {
      const wall = find(d.home, 'walls', input.id);
      const from = wall[input.end];
      const moving = new Set(input.detach ? [wall.id] : cornerWalls(d.home, wall, from).map((m) => m.wall.id));
      const others = d.home.walls.filter((w) => w.level === wall.level && !moving.has(w.id));
      const snapped = snapToWalls(others, input.to, input.snap ?? 0);
      moveWallCorner(d.home, wall, input.end, snapped.point, input.detach ?? false);
      if (snapped.kind === 'corner') d.notes.push(`Joined the corner of ${snapped.walls.join(' and ')}.`);
      if (snapped.host && snapped.along !== undefined) {
        const len = wallLength(snapped.host);
        if (snapped.along > CONNECTED && snapped.along < len - CONNECTED) {
          const tail = splitWallAt(d, snapped.host, snapped.along);
          d.notes.push(`Joined wall "${snapped.host.id}", which was split there (new piece "${tail}").`);
        }
      }
    });
  },
);

export const setWallLength = defineCommand(
  z.strictObject({
    id: IdSchema,
    length: Length,
    /** the end that stays put; the other end moves along the wall */
    keep: z.enum(['start', 'end']).optional(),
  }),
  (d, input) => {
    const wall = find(d.home, 'walls', input.id);
    const keep = input.keep ?? 'start';
    const dir = wallDirection(wall);
    const to: Vec2 = keep === 'start' ? [wall.start[0] + dir[0] * input.length, wall.start[1] + dir[1] * input.length] : [wall.end[0] - dir[0] * input.length, wall.end[1] - dir[1] * input.length];
    keepRoomsOnWalls(d, { create: false }, () => moveWallCorner(d.home, wall, keep === 'start' ? 'end' : 'start', to, false));
  },
);

/** Split a wall in two at a distance from its start. The first piece keeps the id; the
 *  second gets a new one and takes the doors and windows past the split. Returns its id. */
export function splitWallAt(d: Draft, wall: Wall, along: number): string {
  const len = wallLength(wall);
  if (along < MIN_WALL_LENGTH || len - along < MIN_WALL_LENGTH) {
    throw new EditError('wall_too_short', `Splitting wall "${wall.id}" ${m(along)} along would leave a piece shorter than ${m(MIN_WALL_LENGTH)}.`, { id: wall.id, along, length: len });
  }
  const openings = d.home.openings.filter((o) => o.wall === wall.id);
  const inTheWay = openings.find((o) => o.offset < along - TOUCHING && o.offset + o.width > along + TOUCHING);
  if (inTheWay) {
    throw new EditError(
      'opening_in_the_way',
      `Wall "${wall.id}" can't be split ${m(along)} along: ${inTheWay.type} "${inTheWay.id}" spans ${m(inTheWay.offset)} to ${m(inTheWay.offset + inTheWay.width)} there. Move it, or join at another point.`,
      { id: wall.id, along, opening: inTheWay.id },
    );
  }
  const point = pointAlongWall(wall, along);
  const tail: Wall = { ...structuredClone(wall), id: allocateId(d.home, 'wall'), start: point };
  // The split point is placed by whoever split the wall; the far end keeps its own source.
  tail.sources = { ...tail.sources, start: { kind: d.ctx.by } };
  wall.end = point;
  d.home.walls.splice(d.home.walls.indexOf(wall) + 1, 0, tail);
  for (const o of openings) {
    if (o.offset < along - TOUCHING) continue;
    o.wall = tail.id;
    o.offset -= along;
  }
  return tail.id;
}

/**
 * Move a whole wall sideways. Walls that share its corners stretch to follow, and walls that
 * end against it slide along their own direction so they still touch it.
 */
export const moveWall = defineCommand(
  z.strictObject({
    id: IdSchema,
    /** metres towards its left face (as seen walking from start to end); negative for right */
    by: z.number().finite(),
  }),
  (d, input) => {
    keepRoomsOnWalls(d, { create: false }, () => {
      const home = d.home;
      const wall = find(home, 'walls', input.id);
      const normal = leftOf(wallDirection(wall));
      const shift = scale(normal, input.by);
      const partners = (['start', 'end'] as const).map((which) => cornerWalls(home, wall, wall[which]).filter((m) => m.wall !== wall));
      const corners = new Set(partners.flat().map((m) => m.wall));
      const stems: Array<{ wall: Wall; which: 'start' | 'end' }> = [];
      for (const other of home.walls) {
        if (other === wall || other.level !== wall.level || corners.has(other)) continue;
        for (const which of ['start', 'end'] as const) {
          if (distanceToWallBody(wall, other[which]) <= JOIN_TOLERANCE) stems.push({ wall: other, which });
        }
      }

      wall.start = add(wall.start, shift);
      wall.end = add(wall.end, shift);
      partners.forEach((list, i) => {
        for (const m of list) moveEnd(home, m.wall, m.which, i === 0 ? wall.start : wall.end);
      });
      for (const stem of stems) {
        // Slide the end along the stem's own line until it is as far from the moved wall's
        // line as it was before.
        const out = stem.which === 'end' ? wallDirection(stem.wall) : scale(wallDirection(stem.wall), -1);
        const along = dot(out, normal);
        if (Math.abs(along) < 1e-6) continue;
        moveWallCorner(home, stem.wall, stem.which, add(stem.wall[stem.which], scale(out, input.by / along)), false);
      }
      const moved = stems.length ? ` ${stems.map((s) => `"${s.wall.id}"`).join(', ')} followed.` : '';
      d.notes.push(`Moved wall "${wall.id}" ${m(Math.abs(input.by))} towards its ${input.by >= 0 ? 'left' : 'right'} face.${moved}`);
    });
  },
);

/** The wall ends at a corner: this wall's, plus every other wall end on the same point. */
export function cornerWalls(home: Home, wall: Wall, at: Vec2): Array<{ wall: Wall; which: 'start' | 'end' }> {
  const found: Array<{ wall: Wall; which: 'start' | 'end' }> = [];
  for (const other of home.walls) {
    if (other.level !== wall.level) continue;
    for (const end of ['start', 'end'] as const) {
      if (distance(other[end], at) <= CONNECTED) found.push({ wall: other, which: end });
    }
  }
  return found;
}

/** Move one end of a wall (and, unless detached, every wall end at the same corner). */
export function moveWallCorner(home: Home, wall: Wall, which: 'start' | 'end', to: Vec2, detach: boolean): void {
  const moving = detach ? [{ wall, which }] : cornerWalls(home, wall, wall[which]);
  for (const m of moving) moveEnd(home, m.wall, m.which, to);
}

// Openings keep their distance from the end that stays put, so they don't move in the room.
function moveEnd(home: Home, wall: Wall, which: 'start' | 'end', to: Vec2): void {
  const oldLength = wallLength(wall);
  wall[which] = [to[0], to[1]];
  const problem = wallLengthProblem(wall);
  if (problem) throw problem;
  if (which === 'start') {
    const grew = wallLength(wall) - oldLength;
    for (const o of home.openings) if (o.wall === wall.id) o.offset += grew;
  }
  checkOpeningsOn(home, wall);
}

/** Refuse an edit that leaves a door or window hanging off the end of its wall. */
function checkOpeningsOn(home: Home, wall: Wall): void {
  for (const o of home.openings) {
    if (o.wall !== wall.id) continue;
    const problem = blockingProblem(
      openingProblems(home, wall, o).filter((p) => p.code === 'opening_outside_wall'),
      false,
    );
    if (problem) {
      throw new EditError(problem.code, `${problem.message} Move or remove "${o.id}" first.`, problem.details);
    }
  }
}
