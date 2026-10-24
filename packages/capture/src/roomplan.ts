// Reading the room layout an iPhone's scanner (RoomPlan) produces: Apple's CapturedRoom as
// JSON. Each element has an identifier, a category and a confidence (objects with a single
// key), a size, and a 4 × 4 transform from its own frame to the AR world. Elements that
// can't be read are reported, never silently dropped.
import { z } from 'zod';

/** A 4 × 4 matrix as 16 numbers in column-major order. */
export type Matrix = number[];
export type Vec3 = [number, number, number];

const Numbers = z.array(z.number().finite());

const ElementSchema = z.looseObject({
  identifier: z.string().min(1),
  category: z.record(z.string(), z.unknown()),
  confidence: z.record(z.string(), z.unknown()).optional(),
  dimensions: Numbers.length(3),
  /** 16 numbers, or 4 columns of 4 */
  transform: z.union([Numbers.length(16), z.array(Numbers.length(4)).length(4)]),
  parentIdentifier: z.string().nullable().optional(),
  polygonCorners: z.array(Numbers.length(3)).optional(),
  curve: z.unknown().optional(),
});

export interface ScanElement {
  id: string;
  category: string;
  /** extra details of the category, e.g. { isOpen: true } for a door */
  details: Record<string, unknown>;
  confidence: 'high' | 'medium' | 'low' | 'unknown';
  /** [width, height, depth] in metres */
  size: Vec3;
  transform: Matrix;
  parent?: string;
  /** corners in the element's own frame (floors, and walls that aren't rectangles) */
  corners?: Vec3[];
  curved: boolean;
}

export interface ScanRoom {
  walls: ScanElement[];
  doors: ScanElement[];
  windows: ScanElement[];
  openings: ScanElement[];
  floors: ScanElement[];
  objects: ScanElement[];
  problems: string[];
}

const GROUPS = ['walls', 'doors', 'windows', 'openings', 'floors', 'objects'] as const;

/** Read a CapturedRoom JSON. Never throws on a bad element; it reports it. */
export function readRoomPlan(raw: unknown): ScanRoom {
  const room: ScanRoom = { walls: [], doors: [], windows: [], openings: [], floors: [], objects: [], problems: [] };
  if (typeof raw !== 'object' || raw === null) {
    room.problems.push('the room layout is not a JSON object');
    return room;
  }
  const seen = new Set<string>();
  for (const group of GROUPS) {
    const list = (raw as Record<string, unknown>)[group];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      room.problems.push(`"${group}" is not a list`);
      continue;
    }
    list.forEach((item, i) => {
      const parsed = ElementSchema.safeParse(item);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        room.problems.push(`${group}[${i}]: ${issue?.path.join('.') || 'element'} ${issue?.message}`);
        return;
      }
      const e = parsed.data;
      if (seen.has(e.identifier)) {
        room.problems.push(`${group}[${i}]: identifier ${e.identifier} is used twice; the second one was left out`);
        return;
      }
      seen.add(e.identifier);
      const transform = Array.isArray(e.transform[0]) ? (e.transform as number[][]).flat() : (e.transform as number[]);
      if (!isRigid(transform)) {
        room.problems.push(`${group}[${i}] (${e.identifier}): its transform stretches or mirrors, so it was left out`);
        return;
      }
      const [category, details] = Object.entries(e.category)[0] ?? ['unknown', {}];
      const confidence = Object.keys(e.confidence ?? {})[0];
      room[group].push({
        id: e.identifier,
        category,
        details: typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {},
        confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'unknown',
        size: e.dimensions as Vec3,
        transform,
        ...(e.parentIdentifier ? { parent: e.parentIdentifier } : {}),
        ...(e.polygonCorners?.length ? { corners: e.polygonCorners as Vec3[] } : {}),
        curved: e.curve !== undefined && e.curve !== null,
      });
    });
  }
  return room;
}

// ---------- matrices ----------

/** Column `i` of a matrix (0 = local x, 1 = local y, 2 = local z, 3 = position). */
export function column(m: Matrix, i: number): Vec3 {
  return [m[4 * i]!, m[4 * i + 1]!, m[4 * i + 2]!];
}

/** Apply a matrix to a point in the element's frame. */
export function transformPoint(m: Matrix, p: Vec3): Vec3 {
  return [0, 1, 2].map((r) => m[r]! * p[0] + m[4 + r]! * p[1] + m[8 + r]! * p[2] + m[12 + r]!) as Vec3;
}

/** A rotation plus a move, with no stretching or mirroring (what the scanner should give). */
export function isRigid(m: Matrix, tolerance = 1e-3): boolean {
  if (Math.abs(m[3]!) > 1e-4 || Math.abs(m[7]!) > 1e-4 || Math.abs(m[11]!) > 1e-4 || Math.abs(m[15]! - 1) > 1e-4) return false;
  const [x, y, z] = [column(m, 0), column(m, 1), column(m, 2)];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const orthonormal = [dot(x, x) - 1, dot(y, y) - 1, dot(z, z) - 1, dot(x, y), dot(y, z), dot(x, z)].every((v) => Math.abs(v) <= tolerance);
  const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  return orthonormal && det > 0;
}
