// Plan geometry on the floor plane. Points are [x, z] in metres.
import type { Item, Opening, Vec2, Vec3, Wall } from './schema.ts';

export const EPS = 1e-6;

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}

/** Left of a direction as seen from above (x right, z down the screen). */
export const leftOf = (d: Vec2): Vec2 => [d[1], -d[0]];

export const round = (v: number, step = 0.001): number => Math.round(v / step) * step;

// ---------- walls ----------

export function wallVector(w: Pick<Wall, 'start' | 'end'>): Vec2 {
  return sub(w.end, w.start);
}

export function wallLength(w: Pick<Wall, 'start' | 'end'>): number {
  return length(wallVector(w));
}

export function wallDirection(w: Pick<Wall, 'start' | 'end'>): Vec2 {
  return normalize(wallVector(w));
}

/** Offsets of the left and right faces from the wall's reference line, measured along the
 *  left normal. A centred wall of 0.2 m gives { left: 0.1, right: -0.1 }. */
export function faceOffsets(w: Pick<Wall, 'thickness' | 'line'>): { left: number; right: number } {
  const t = w.thickness;
  if (w.line === 'left') return { left: 0, right: -t };
  if (w.line === 'right') return { left: t, right: 0 };
  return { left: t / 2, right: -t / 2 };
}

/** The four corners of a wall's footprint, without corner joins:
 *  start-left, end-left, end-right, start-right. */
export function wallFootprint(w: Pick<Wall, 'start' | 'end' | 'thickness' | 'line'>): Vec2[] {
  const n = leftOf(wallDirection(w));
  const o = faceOffsets(w);
  return [add(w.start, scale(n, o.left)), add(w.end, scale(n, o.left)), add(w.end, scale(n, o.right)), add(w.start, scale(n, o.right))];
}

/** Point on the wall's reference line at a distance along it. */
export function pointAlongWall(w: Pick<Wall, 'start' | 'end'>, distanceFromStart: number): Vec2 {
  return add(w.start, scale(wallDirection(w), distanceFromStart));
}

/** Project a plan point onto a wall: distance along it and signed distance to its left. */
export function projectOntoWall(w: Pick<Wall, 'start' | 'end'>, p: Vec2): { along: number; left: number } {
  const d = wallDirection(w);
  const rel = sub(p, w.start);
  return { along: dot(rel, d), left: dot(rel, leftOf(d)) };
}

/** Start and end of an opening, as distances along its wall. */
export function openingRange(o: Pick<Opening, 'offset' | 'width'>): [number, number] {
  return [o.offset, o.offset + o.width];
}

// ---------- polygons ----------

/** Signed area (positive when counter-clockwise in a y-up frame). */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export const polygonArea = (poly: Vec2[]): number => Math.abs(signedArea(poly));

export function polygonPerimeter(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += distance(poly[i]!, poly[(i + 1) % poly.length]!);
  return s;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    const sum = poly.reduce<Vec2>((acc, p) => add(acc, p), [0, 0]);
    return scale(sum, 1 / poly.length);
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cz += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function bounds(points: Vec2[]): { min: Vec2; max: Vec2; size: Vec2 } {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of points) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  return { min: [minX, minZ], max: [maxX, maxZ], size: [maxX - minX, maxZ - minZ] };
}

/** Do two convex polygons overlap by more than `tolerance` metres? (separating axis test) */
export function convexOverlap(a: Vec2[], b: Vec2[], tolerance = 0.001): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const axis = normalize(leftOf(sub(q, p)));
      if (length(axis) < EPS) continue;
      let minA = Infinity;
      let maxA = -Infinity;
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of a) {
        const d = dot(v, axis);
        minA = Math.min(minA, d);
        maxA = Math.max(maxA, d);
      }
      for (const v of b) {
        const d = dot(v, axis);
        minB = Math.min(minB, d);
        maxB = Math.max(maxB, d);
      }
      if (maxA - minB <= tolerance || maxB - minA <= tolerance) return false;
    }
  }
  return true;
}

/** Shortest distance from a point to a segment. */
export function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  const t = len2 < EPS ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
  return distance(p, add(a, scale(ab, t)));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Shortest distance between two polygons' outlines (0 if they overlap or touch). */
export function polygonDistance(a: Vec2[], b: Vec2[]): number {
  if (convexOverlap(a, b, 0)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
      best = Math.min(best, pointSegmentDistance(a1, b1, b2), pointSegmentDistance(a2, b1, b2), pointSegmentDistance(b1, a1, a2), pointSegmentDistance(b2, a1, a2));
    }
  }
  return best;
}

/** Simple self-intersection check for room outlines. */
export function isSimplePolygon(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

// ---------- items ----------

/** Rotated footprint rectangle of an item. */
export function itemFootprint(item: Pick<Item, 'position' | 'rotation' | 'size'>): Vec2[] {
  const [w, , d] = item.size;
  const a = (item.rotation * Math.PI) / 180;
  // Rotation about +Y by a: local x → (cos a, -sin a), local z → (sin a, cos a) in [x, z].
  const ux: Vec2 = [Math.cos(a), -Math.sin(a)];
  const uz: Vec2 = [Math.sin(a), Math.cos(a)];
  const c: Vec2 = [item.position[0], item.position[2]];
  const hx = scale(ux, w / 2);
  const hz = scale(uz, d / 2);
  return [add(add(c, scale(hx, -1)), scale(hz, -1)), add(add(c, hx), scale(hz, -1)), add(add(c, hx), hz), add(add(c, scale(hx, -1)), hz)];
}

/** How far two boxes differ in shape, ignoring scale: 0 = same proportions, 0.05 = 5%. */
export function shapeMismatch(a: Vec3, b: Vec3): number {
  const r = [b[0] / a[0], b[1] / a[1], b[2] / a[2]];
  return Math.max(...r) / Math.min(...r) - 1;
}
