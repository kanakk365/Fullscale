// Placement helpers: turn "against that wall" or "in the middle of the room" into exact
// positions and rotations, so neither people nor agents have to do the trigonometry.
import { add, faceOffsets, leftOf, polygonCentroid, scale, wallDirection, wallLength } from './geometry.ts';
import { getRoom, getWall, roomWallFaces } from './measure.ts';
import { EditError } from './errors.ts';
import { pointInPolygon } from './geometry.ts';
import type { Home, Vec2, Vec3 } from './schema.ts';

export interface Placement {
  position: Vec3;
  rotation: number;
}

/** Which face of a wall looks into a room (or into any room if none is given). */
export function roomSideOfWall(home: Home, wallId: string, roomId?: string): 'left' | 'right' {
  if (roomId) {
    const face = roomWallFaces(home, roomId).find((f) => f.wall === wallId);
    if (face) return face.face;
  }
  const w = getWall(home, wallId);
  const n = leftOf(wallDirection(w));
  const off = faceOffsets(w);
  const mid: Vec2 = [(w.start[0] + w.end[0]) / 2, (w.start[1] + w.end[1]) / 2];
  const rooms = home.rooms.filter((r) => r.level === w.level && (!roomId || r.id === roomId));
  for (const face of ['left', 'right'] as const) {
    const sign = face === 'left' ? 1 : -1;
    const probe = add(mid, scale(n, off[face] + sign * 0.1));
    if (rooms.some((r) => pointInPolygon(probe, r.polygon))) return face;
  }
  return 'left';
}

/**
 * Stand an item with its back against a wall face.
 * @param along distance along the wall (from its start) to the item's centre; default middle
 * @param gap space between the wall and the item's back
 */
export function placeAgainstWall(
  home: Home,
  opts: { wall: string; size: [number, number, number]; along?: number; gap?: number; face?: 'left' | 'right'; room?: string; elevation?: number },
): Placement {
  const w = getWall(home, opts.wall);
  const len = wallLength(w);
  const along = opts.along ?? len / 2;
  const [width, , depth] = opts.size;
  if (along - width / 2 < -0.001 || along + width / 2 > len + 0.001) {
    throw new EditError(
      'item_past_wall_end',
      `An item ${width} m wide centred ${along.toFixed(3)} m along wall "${w.id}" would run past its ends (the wall is ${len.toFixed(3)} m long). Centre it between ${(width / 2).toFixed(3)} and ${(len - width / 2).toFixed(3)} m.`,
      { wall: w.id, along, width, wallLength: len },
    );
  }
  const face = opts.face ?? roomSideOfWall(home, w.id, opts.room);
  const d = wallDirection(w);
  const left = leftOf(d);
  const normal: Vec2 = face === 'left' ? left : [-left[0], -left[1]];
  const faceOffset = faceOffsets(w)[face];
  const onFace = add(add(w.start, scale(d, along)), scale(left, faceOffset));
  const centre = add(onFace, scale(normal, depth / 2 + (opts.gap ?? 0.01)));
  // Item front is local +z, which points along (sin a, cos a) after rotation a.
  const rotation = Math.round(((Math.atan2(normal[0], normal[1]) * 180) / Math.PI) * 1000) / 1000;
  return { position: [round3(centre[0]), opts.elevation ?? 0, round3(centre[1])], rotation: normalizeDegrees(rotation) };
}

/** Centre of a room's floor (its area centroid). */
export function roomCentre(home: Home, roomId: string): Vec2 {
  const c = polygonCentroid(getRoom(home, roomId).polygon);
  return [round3(c[0]), round3(c[1])];
}

export function normalizeDegrees(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return Math.abs(r - 360) < 1e-9 ? 0 : r;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
