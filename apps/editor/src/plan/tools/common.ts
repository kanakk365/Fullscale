// Helpers the plan tools share: snapping the pointer, standing furniture against walls, and
// the little markers that show what the pointer snapped to.
import { faceOffsets, placeAgainstWall, projectOntoWall, snapPoint, wallLength, type Home, type Snap, type Vec2, type Vec3 } from '@fullscale/core';
import { radiiAt, type PlanContext, type PlanPointer } from '../types.ts';

export function levelWalls(ctx: PlanContext) {
  return ctx.home.walls.filter((w) => w.level === ctx.level);
}

/** Snap the pointer for drawing; Alt places it exactly where it is. */
export function snapPointer(p: PlanPointer, ctx: PlanContext, opts: { from?: Vec2; exclude?: ReadonlySet<string> } = {}): Snap {
  return snapPoint(levelWalls(ctx), p.point, {
    mode: p.alt ? 'off' : ctx.snap,
    grid: ctx.grid,
    angleStep: 15,
    radius: radiiAt(ctx.scale),
    ...(opts.from ? { from: opts.from } : {}),
    ...(opts.exclude ? { exclude: opts.exclude } : {}),
  });
}

/** Furniture whose back comes within this many pixels of a wall face stands against it. */
const AGAINST_WALL_PX = 16;

/**
 * If an item centred at `centre` is close to a wall face, the pose that stands it with its
 * back to that face (1 cm off it), facing into the room.
 */
export function againstWall(home: Home, level: string, size: [number, number, number], centre: Vec2, scale: number): { position: Vec3; rotation: number; wall: string } | null {
  const reach = AGAINST_WALL_PX / scale;
  let best: { wall: string; face: 'left' | 'right'; along: number; gap: number } | null = null;
  for (const w of home.walls) {
    if (w.level !== level) continue;
    const { along, left } = projectOntoWall(w, centre);
    if (along < size[0] / 2 || along > wallLength(w) - size[0] / 2) continue;
    const off = faceOffsets(w);
    const face = left >= (off.left + off.right) / 2 ? 'left' : 'right';
    const fromFace = face === 'left' ? left - off.left : off.right - left;
    const gap = Math.abs(fromFace - size[2] / 2);
    if (fromFace < 0 || gap > reach) continue;
    if (!best || gap < best.gap) best = { wall: w.id, face, along, gap };
  }
  if (!best) return null;
  try {
    return { ...placeAgainstWall(home, { wall: best.wall, size, along: best.along, face: best.face, gap: 0.01 }), wall: best.wall };
  } catch {
    return null;
  }
}

export const round = (v: number, step: number) => Math.round(v / step) * step;
