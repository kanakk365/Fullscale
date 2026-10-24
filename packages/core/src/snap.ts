// Where a pointer lands when drawing or dragging walls. Special points (corners, wall
// middles, crossings) are looked for around the raw pointer first, so a grid or angle snap
// can never hide them. A short "connect" snap works in every mode except off, so rooms can
// always be closed. Radii are metres; an editor converts its pixel radii at the current
// zoom, so snapping feels the same zoomed in or out.
import { add, cross, distance, dot, lerp, scale, sub, wallDirection, wallLength } from './geometry.ts';
import { JOIN_TOLERANCE } from './joins.ts';
import { distanceToWallBody } from './topology.ts';
import type { Vec2, Wall } from './schema.ts';

export type SnapMode = 'lines' | 'grid' | 'angles' | 'off';

export type SnapKind = 'corner' | 'middle' | 'crossing' | 'wall' | 'grid' | 'angle';

export interface Snap {
  point: Vec2;
  /** what the point snapped to; null when it is the raw pointer */
  kind: SnapKind | null;
  /** the walls involved, for highlighting and for telling an agent why a point moved */
  walls: string[];
}

export interface SnapOptions {
  mode: SnapMode;
  /** where the wall being drawn starts; enables angle steps */
  from?: Vec2;
  /** grid step in metres */
  grid?: number;
  /** angle step in degrees for `angles` mode */
  angleStep?: number;
  /** search radii in metres */
  radius: { corner: number; middle: number; wall: number };
  /** always-on snap to corners and walls (not in `off` mode) */
  connect?: number;
  /** walls to leave out, e.g. the ones being dragged */
  exclude?: ReadonlySet<string>;
}

export const DEFAULT_CONNECT = 0.05;

/** Snap a pointer position on a level's walls. */
export function snapPoint(walls: readonly Wall[], raw: Vec2, opts: SnapOptions): Snap {
  if (opts.mode === 'off') return { point: raw, kind: null, walls: [] };
  const candidates = walls.filter((w) => !opts.exclude?.has(w.id) && wallLength(w) > 0);

  if (opts.mode === 'lines') {
    const special = specialPoint(candidates, raw, opts.radius.corner, opts.radius.middle);
    if (special) return special;
  }

  let base: Snap = { point: raw, kind: null, walls: [] };
  if (opts.mode === 'angles' && opts.from) base = { point: angleSnap(opts.from, raw, opts.angleStep ?? 15, opts.grid), kind: 'angle', walls: [] };
  else if (opts.mode === 'grid' && opts.grid) base = { point: gridSnap(raw, opts.grid), kind: 'grid', walls: [] };

  if (opts.mode === 'lines') return onWall(candidates, raw, opts.radius.wall) ?? base;
  // Every other mode: a short connect snap from the snapped point, so walls still close.
  const connect = opts.connect ?? DEFAULT_CONNECT;
  return specialPoint(candidates, base.point, connect, 0) ?? onWall(candidates, base.point, connect) ?? base;
}

/** Snap to wall corners, then wall bodies, within `radius`. What drawing commands use. */
export function snapToWalls(walls: readonly Wall[], p: Vec2, radius: number): Snap & { host?: Wall; along?: number } {
  if (radius <= 0) return { point: p, kind: null, walls: [] };
  const corner = specialPoint(walls, p, radius, 0);
  if (corner) return corner;
  const body = onWall(walls, p, radius);
  if (!body) return { point: p, kind: null, walls: [] };
  const host = walls.find((w) => w.id === body.walls[0])!;
  return { ...body, host, along: dot(sub(body.point, host.start), wallDirection(host)) };
}

function specialPoint(walls: readonly Wall[], p: Vec2, cornerRadius: number, middleRadius: number): Snap | null {
  let corner: { point: Vec2; d: number } | null = null;
  for (const w of walls) {
    for (const q of [w.start, w.end]) {
      const d = distance(p, q);
      if (d <= cornerRadius && (!corner || d < corner.d)) corner = { point: q, d };
    }
  }
  if (corner) {
    const at = corner.point;
    const ids = walls.filter((w) => distance(w.start, at) <= JOIN_TOLERANCE || distance(w.end, at) <= JOIN_TOLERANCE).map((w) => w.id);
    return { point: [at[0], at[1]], kind: 'corner', walls: ids };
  }
  if (middleRadius <= 0) return null;

  let best: (Snap & { d: number }) | null = null;
  const consider = (point: Vec2, kind: SnapKind, ids: string[]) => {
    const d = distance(p, point);
    if (d <= middleRadius && (!best || d < best.d)) best = { point, kind, walls: ids, d };
  };
  for (const w of walls) consider(lerp(w.start, w.end, 0.5), 'middle', [w.id]);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const x = crossing(walls[i]!, walls[j]!);
      if (x) consider(x, 'crossing', [walls[i]!.id, walls[j]!.id]);
    }
  }
  if (!best) return null;
  const { d: _d, ...snap } = best as Snap & { d: number };
  return snap;
}

function crossing(a: Wall, b: Wall): Vec2 | null {
  const da = wallDirection(a);
  const db = wallDirection(b);
  const det = cross(da, db);
  if (Math.abs(det) < 1e-9) return null;
  const rel = sub(b.start, a.start);
  const s = cross(rel, db) / det;
  const u = cross(rel, da) / det;
  if (s < 0 || s > wallLength(a) || u < 0 || u > wallLength(b)) return null;
  return add(a.start, scale(da, s));
}

/** The point on the nearest wall's line, if the pointer is on or near that wall's body. */
function onWall(walls: readonly Wall[], p: Vec2, radius: number): Snap | null {
  let best: { wall: Wall; d: number } | null = null;
  for (const w of walls) {
    const d = distanceToWallBody(w, p);
    if (d <= radius && (!best || d < best.d)) best = { wall: w, d };
  }
  if (!best) return null;
  const w = best.wall;
  const t = Math.min(wallLength(w), Math.max(0, dot(sub(p, w.start), wallDirection(w))));
  return { point: add(w.start, scale(wallDirection(w), t)), kind: 'wall', walls: [w.id] };
}

/** Round a point to the grid. */
export function gridSnap(p: Vec2, step: number): Vec2 {
  return [tidy(Math.round(p[0] / step) * step), tidy(Math.round(p[1] / step) * step)];
}

/** Put the point on the nearest ray from `from` at a multiple of `stepDegrees`, and round
 *  its distance along that ray to `lengthStep`. Rounding x and z separately would pull a
 *  point off a diagonal ray, so the distance is rounded instead. */
export function angleSnap(from: Vec2, p: Vec2, stepDegrees: number, lengthStep?: number): Vec2 {
  const rel = sub(p, from);
  const len = Math.hypot(rel[0], rel[1]);
  if (len === 0) return from;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(rel[1], rel[0]) / step) * step;
  const dir: Vec2 = [Math.cos(angle), Math.sin(angle)];
  let along = Math.max(0, dot(rel, dir));
  if (lengthStep) along = Math.round(along / lengthStep) * lengthStep;
  return [tidy(from[0] + dir[0] * along), tidy(from[1] + dir[1] * along)];
}

const tidy = (v: number) => Number(v.toPrecision(12));

/**
 * Snap to wall faces instead of wall lines: for drawing room outlines, which run along the
 * finished faces. Face corners win within the corner radius; otherwise the point lands on
 * the nearest face. In grid and angle modes only the short connect snap applies.
 */
export function snapToFaces(faces: ReadonlyArray<{ wall: string; points: Vec2[] }>, raw: Vec2, opts: Pick<SnapOptions, 'mode' | 'grid' | 'radius' | 'connect'>): Snap {
  if (opts.mode === 'off') return { point: raw, kind: null, walls: [] };
  const lines = opts.mode === 'lines';
  const base: Snap = !lines && opts.mode === 'grid' && opts.grid ? { point: gridSnap(raw, opts.grid), kind: 'grid', walls: [] } : { point: raw, kind: null, walls: [] };
  const from = lines ? raw : base.point;
  const cornerReach = lines ? opts.radius.corner : (opts.connect ?? DEFAULT_CONNECT);
  const faceReach = lines ? opts.radius.wall : (opts.connect ?? DEFAULT_CONNECT);

  let corner: { point: Vec2; d: number; wall: string } | null = null;
  for (const f of faces) {
    for (const p of f.points) {
      const d = distance(from, p);
      if (d <= cornerReach && (!corner || d < corner.d)) corner = { point: p, d, wall: f.wall };
    }
  }
  if (corner) return { point: [corner.point[0], corner.point[1]], kind: 'corner', walls: [corner.wall] };

  let best: { point: Vec2; d: number; wall: string } | null = null;
  for (const f of faces) {
    for (let i = 0; i < f.points.length; i++) {
      const a = f.points[i]!;
      const b = f.points[(i + 1) % f.points.length]!;
      const ab = sub(b, a);
      const len2 = dot(ab, ab);
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, dot(sub(from, a), ab) / len2));
      const p = add(a, scale(ab, t));
      const d = distance(from, p);
      if (d <= faceReach && (!best || d < best.d)) best = { point: p, d, wall: f.wall };
    }
  }
  return best ? { point: best.point, kind: 'wall', walls: [best.wall] } : base;
}
