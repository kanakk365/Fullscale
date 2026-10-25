// Where a phone capture's world lies in the home. The importer turns a capture so most of its
// walls run along the plan's axes and moves it next to what is already there; `toHome`
// records that, so everything else from the capture (its mesh, photos and detailed model)
// lines up with the walls it made.
import type { CaptureRef, Vec2 } from './schema.ts';

export type ToHome = NonNullable<CaptureRef['toHome']>;

/** A point of the capture's world, `(x, z)` seen from above, on the plan. */
export function captureToPlan(toHome: ToHome, x: number, z: number): Vec2 {
  const yaw = (toHome.yaw * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin + toHome.offset[0], -x * sin + z * cos + toHome.offset[1]];
}

/**
 * The capture's world in the home, as 16 numbers in column-major order (what three.js's
 * `Matrix4.fromArray` reads): turned about +Y by `yaw`, moved to `offset`, and lifted so the
 * capture's floor sits on its level's floor.
 */
export function captureToHomeMatrix(toHome: ToHome, levelElevation: number): number[] {
  const yaw = (toHome.yaw * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, toHome.offset[0], levelElevation - toHome.floorY, toHome.offset[1], 1];
}
