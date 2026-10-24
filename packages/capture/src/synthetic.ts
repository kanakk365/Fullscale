// Synthetic scanner output, for tests and demos. Real scans of homes are private, so tests
// build scanner-style room layouts from known rooms instead, placed in a turned and shifted
// AR world, and check that importing them gives the known rooms back.
import type { Vec2 } from '@fullscale/core';
import type { Matrix, Vec3 } from './roomplan.ts';

export interface SyntheticRoom {
  name?: string;
  /** the room's inside outline at the wall faces, in order */
  corners: Vec2[];
  height: number;
  doors?: Array<{ wall: number; offset: number; width: number; height: number }>;
  windows?: Array<{ wall: number; offset: number; width: number; height: number; sill: number }>;
  objects?: Array<{ category: string; position: Vec2; size: Vec3; rotation: number; bottom?: number }>;
  /** leave out the floor outline, as older scanner versions do */
  noFloor?: boolean;
  confidence?: 'high' | 'medium' | 'low';
}

export interface SyntheticWorld {
  /** how the AR world is turned from the room's frame, degrees counter-clockwise seen from above */
  yaw: number;
  /** where the room's frame origin is in the AR world; y is the floor height */
  offset: Vec3;
}

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

/** A room-layout JSON like the scanner's, for a known room placed in a world. */
export function syntheticRoomPlan(room: SyntheticRoom, world: SyntheticWorld): Record<string, unknown> {
  const confidence = { [room.confidence ?? 'high']: {} };
  const a = (world.yaw * Math.PI) / 180;
  // Room frame → world, with the same turn convention as items: local x → (cos a, −sin a).
  const place = (x: number, y: number, z: number): Vec3 => [world.offset[0] + x * Math.cos(a) + z * Math.sin(a), world.offset[1] + y, world.offset[2] - x * Math.sin(a) + z * Math.cos(a)];
  const turnDir = (x: number, z: number): Vec3 => [x * Math.cos(a) + z * Math.sin(a), 0, -x * Math.sin(a) + z * Math.cos(a)];
  /** A transform whose local x runs along `dir` (plan), y up, centred at `centre`. */
  const frame = (dir: Vec2, centre: Vec3): Matrix => {
    const x = turnDir(dir[0], dir[1]);
    // z = x × y (right-handed): the wall's normal.
    const z: Vec3 = [-x[2], 0, x[0]];
    return [x[0], 0, x[2], 0, 0, 1, 0, 0, z[0], 0, z[2], 0, centre[0], centre[1], centre[2], 1];
  };

  const walls = room.corners.map((start, i) => {
    const end = room.corners[(i + 1) % room.corners.length]!;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const dir: Vec2 = [(end[0] - start[0]) / len, (end[1] - start[1]) / len];
    const mid = place((start[0] + end[0]) / 2, room.height / 2, (start[1] + end[1]) / 2);
    return { identifier: uuid(), category: { wall: {} }, confidence, dimensions: [len, room.height, 0], transform: frame(dir, mid), start, dir };
  });

  const onWall = (wallIndex: number, offset: number, width: number, height: number, bottom: number) => {
    const w = walls[wallIndex]!;
    const along = offset + width / 2;
    const centre = place(w.start[0] + w.dir[0] * along, bottom + height / 2, w.start[1] + w.dir[1] * along);
    return { identifier: uuid(), confidence, dimensions: [width, height, 0], transform: frame(w.dir, centre), parentIdentifier: w.identifier };
  };

  const floor = {
    identifier: uuid(),
    category: { floor: {} },
    confidence,
    dimensions: [0, 0, 0],
    // The floor's own frame is the room frame at floor height, so its corners are the outline.
    transform: [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, world.offset[0], world.offset[1], world.offset[2], 1],
    polygonCorners: room.corners.map(([x, z]) => [x, 0, z]),
  };

  return {
    walls: walls.map(({ start: _s, dir: _d, ...w }) => w),
    doors: (room.doors ?? []).map((d) => ({ ...onWall(d.wall, d.offset, d.width, d.height, 0), category: { door: { isOpen: false } } })),
    windows: (room.windows ?? []).map((w) => ({ ...onWall(w.wall, w.offset, w.width, w.height, w.sill), category: { window: {} } })),
    openings: [],
    floors: room.noFloor ? [] : [floor],
    objects: (room.objects ?? []).map((o) => {
      const r = (o.rotation * Math.PI) / 180;
      // The object's local x is (cos r, −sin r) in the room frame, so its front (+z) is (sin r, cos r).
      return {
        identifier: uuid(),
        category: { [o.category]: {} },
        confidence,
        dimensions: o.size,
        transform: frame([Math.cos(r), -Math.sin(r)], place(o.position[0], (o.bottom ?? 0) + o.size[1] / 2, o.position[1])),
      };
    }),
  };
}
