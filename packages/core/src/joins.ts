// Where wall faces stop at corners and T-junctions, so walls meet cleanly at any angle.
// The 2D plan and the 3D builder both use this, so they always show the same corners.
//
// At each junction the walls are sorted by the direction they leave it in. Each wall's
// face is intersected with the facing face of its neighbour; that point is where both
// faces stop. A wall passing straight through a junction (the top of a T) keeps its faces
// whole, and the wall ending against it stops at its near face.
import { add, cross, distance, dot, leftOf, pointSegmentDistance, scale, sub, wallDirection, wallLength, faceOffsets } from './geometry.ts';
import { MIN_WALL_LENGTH } from './rules.ts';
import type { Home, Vec2, Wall } from './schema.ts';

/** Wall ends closer than this meet at a junction. Matches how precisely people and
 *  scans place corners. */
export const JOIN_TOLERANCE = 0.02;

/** A corner further from the junction than this many half-thicknesses is not mitred (the
 *  end stays square). Keeps very sharp angles from producing long spikes; 10× still
 *  mitres angles down to about 11°. */
export const MITRE_LIMIT = 10;

/** Where a wall's left and right faces stop at one end, in plan. */
export interface WallEnd {
  left: Vec2;
  right: Vec2;
}

export interface WallJoin {
  start: WallEnd;
  end: WallEnd;
}

export interface LevelJoins {
  walls: Map<string, WallJoin>;
  /** small polygons to fill where three or more walls end at one point */
  hubs: Vec2[][];
}

interface Line {
  point: Vec2;
  dir: Vec2;
}

// One wall as seen from a junction: the direction it leaves in, and its two faces named by
// which side of that direction they are on.
interface Entry {
  wall: Wall;
  which: 'start' | 'end';
  /** passes through the junction rather than ending there */
  host: boolean;
  out: Vec2;
  angle: number;
  cw: Line;
  ccw: Line;
  halfThickness: number;
}

function faceLine(wall: Wall, face: 'left' | 'right'): Line {
  const d = wallDirection(wall);
  return { point: add(wall.start, scale(leftOf(d), faceOffsets(wall)[face])), dir: d };
}

function entry(wall: Wall, which: 'start' | 'end', host: boolean, forward: boolean): Entry {
  const d = wallDirection(wall);
  const out = forward ? d : scale(d, -1);
  // leftOf(out) is the clockwise side in plan coordinates.
  const cwFace = forward ? 'left' : 'right';
  const ccwFace = forward ? 'right' : 'left';
  return {
    wall,
    which,
    host,
    out,
    angle: Math.atan2(out[1], out[0]),
    cw: faceLine(wall, cwFace),
    ccw: faceLine(wall, ccwFace),
    halfThickness: wall.thickness / 2,
  };
}

function intersect(a: Line, b: Line): Vec2 | null {
  const det = cross(a.dir, b.dir);
  if (Math.abs(det) < 1e-9) return null;
  const t = cross(sub(b.point, a.point), b.dir) / det;
  return add(a.point, scale(a.dir, t));
}

function squareJoin(wall: Wall): WallJoin {
  const n = leftOf(wallDirection(wall));
  const off = faceOffsets(wall);
  const at = (p: Vec2): WallEnd => ({ left: add(p, scale(n, off.left)), right: add(p, scale(n, off.right)) });
  return { start: at(wall.start), end: at(wall.end) };
}

/** Corner points for every wall on a level. */
export function levelJoins(home: Home, levelId: string): LevelJoins {
  const walls = home.walls.filter((w) => w.level === levelId && wallLength(w) >= MIN_WALL_LENGTH);
  const joins = new Map(walls.map((w) => [w.id, squareJoin(w)]));
  const hubs: Vec2[][] = [];

  for (const group of junctions(walls)) {
    const point = average(group.map((g) => g.wall[g.which]));
    const inGroup = new Set(group.map((g) => g.wall.id));
    const entries = group.map((g) => entry(g.wall, g.which, false, g.which === 'start'));
    for (const w of walls) {
      if (inGroup.has(w.id) || !passesThrough(w, point)) continue;
      entries.push(entry(w, 'start', true, true), entry(w, 'end', true, false));
    }
    if (entries.length < 2) continue;
    // Sort by angle; ties by id so the result never depends on the order walls are listed.
    entries.sort((a, b) => a.angle - b.angle || a.wall.id.localeCompare(b.wall.id) || a.which.localeCompare(b.which));

    const corners: Array<Vec2 | null> = [];
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i]!;
      const b = entries[(i + 1) % entries.length]!;
      const p = intersect(a.ccw, b.cw);
      const limit = MITRE_LIMIT * Math.max(a.halfThickness, b.halfThickness);
      if (!p || distance(p, point) > limit) {
        corners.push(null);
        continue;
      }
      corners.push(p);
      if (!a.host) setCorner(joins, a, 'ccw', p);
      if (!b.host) setCorner(joins, b, 'cw', p);
    }

    const ends = entries.filter((e) => !e.host).length;
    if (ends >= 3 && ends === entries.length && corners.every((c) => c !== null)) hubs.push(corners as Vec2[]);
  }
  return { walls: joins, hubs };
}

function setCorner(joins: Map<string, WallJoin>, e: Entry, side: 'cw' | 'ccw', p: Vec2): void {
  const forward = e.which === 'start';
  const face = (side === 'cw') === forward ? 'left' : 'right';
  joins.get(e.wall.id)![e.which][face] = p;
}

/** Groups of wall ends that meet, found with a distance check rather than rounding, so two
 *  points either side of a rounding boundary still join. */
function junctions(walls: Wall[]): Array<Array<{ wall: Wall; which: 'start' | 'end' }>> {
  const ends = walls.flatMap((wall) => [
    { wall, which: 'start' as const },
    { wall, which: 'end' as const },
  ]);
  const parent = ends.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!;
      const b = ends[j]!;
      if (a.wall === b.wall) continue;
      if (distance(a.wall[a.which], b.wall[b.which]) <= JOIN_TOLERANCE) parent[root(i)] = root(j);
    }
  }
  const groups = new Map<number, typeof ends>();
  ends.forEach((e, i) => {
    const r = root(i);
    groups.set(r, [...(groups.get(r) ?? []), e]);
  });
  return [...groups.values()];
}

/** Does the wall's reference line pass through this point away from its own ends? */
function passesThrough(wall: Wall, p: Vec2): boolean {
  if (pointSegmentDistance(p, wall.start, wall.end) > JOIN_TOLERANCE) return false;
  const along = dot(sub(p, wall.start), wallDirection(wall));
  return along > JOIN_TOLERANCE && along < wallLength(wall) - JOIN_TOLERANCE;
}

function average(points: Vec2[]): Vec2 {
  const sum = points.reduce((s, p) => add(s, p), [0, 0] as Vec2);
  return scale(sum, 1 / points.length);
}

/** A wall's plan outline with its joined corners: start-left, end-left, end-right, start-right. */
export function joinedOutline(join: WallJoin): Vec2[] {
  return [join.start.left, join.end.left, join.end.right, join.start.right];
}

/** Distances along the wall (from its start) where each face stops, for building the wall
 *  between them. A mitred corner makes the two faces stop at different places. */
export function faceStops(wall: Wall, join: WallJoin): { start: { left: number; right: number }; end: { left: number; right: number } } {
  const d = wallDirection(wall);
  const along = (p: Vec2) => dot(sub(p, wall.start), d);
  return {
    start: { left: along(join.start.left), right: along(join.start.right) },
    end: { left: along(join.end.left), right: along(join.end.right) },
  };
}
