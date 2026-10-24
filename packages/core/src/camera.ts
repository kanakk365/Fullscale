// Where to put a camera to see the home, or some elements of it, from a named side or from
// a given eye. The editor's 3D views, pictures for agents and Blender renders all use this,
// so "the view from the south" means the same everywhere.
import { bounds, wallFootprint } from './geometry.ts';
import { elementOutline } from './measure.ts';
import { levelById } from './resolve.ts';
import type { Home, Vec2, Vec3 } from './schema.ts';

export type ViewPreset = 'top' | 'north' | 'south' | 'east' | 'west' | 'three-quarter';

export interface CameraRequest {
  preset?: ViewPreset;
  /** [x, y, z] metres, y up */
  eye?: number[];
  target?: number[];
  /** frame these elements */
  focus?: string[];
  /** vertical field of view in degrees */
  fov?: number;
  level?: string;
}

export interface CameraPose {
  eye: Vec3;
  target: Vec3;
  /** which way is up in the picture */
  up: Vec3;
  fov: number;
  near: number;
  far: number;
}

/** Where each named view looks from, before scaling to the right distance. North is up the
 *  plan (−z), so the view "from the north" stands on the −z side. */
const DIRECTIONS: Readonly<Record<ViewPreset, Vec3>> = {
  top: [0, 1, 0],
  north: [0, 0.45, -1],
  south: [0, 0.45, 1],
  east: [1, 0.45, 0],
  west: [-1, 0.45, 0],
  'three-quarter': [1, 0.9, 1],
};

/** The box to frame: some elements, or everything on the level. */
export function frameBox(home: Home, request: CameraRequest): { min: Vec3; max: Vec3 } {
  const level = request.level ?? home.levels[0]!.id;
  let points: Vec2[] = [];
  for (const id of request.focus ?? []) {
    try {
      const o = elementOutline(home, id);
      points.push(...(typeof o[0] === 'number' ? [o as Vec2] : (o as Vec2[])));
    } catch {
      // An id that no longer exists is simply not framed.
    }
  }
  if (!points.length) points = [...home.walls.filter((w) => w.level === level).flatMap((w) => wallFootprint(w)), ...home.rooms.filter((r) => r.level === level).flatMap((r) => r.polygon)];
  if (!points.length)
    points = [
      [0, 0],
      [5, 5],
    ];
  const b = bounds(points);
  const floor = levelById(home, level);
  return { min: [b.min[0], floor.elevation, b.min[1]], max: [b.max[0], floor.elevation + floor.height, b.max[1]] };
}

/** A camera for a request, for a picture `aspect` wide per unit of height. */
export function cameraPose(home: Home, request: CameraRequest, aspect: number): CameraPose {
  const fov = request.fov ?? 40;
  const box = frameBox(home, request);
  const centre: Vec3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const radius = Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2;
  if (request.eye) {
    const eye = request.eye as Vec3;
    const target = (request.target ?? centre) as Vec3;
    return { eye, target, up: [0, 1, 0], fov, near: 0.05, far: 1000 };
  }
  const preset = request.preset ?? 'three-quarter';
  // Far enough that a sphere around the frame fits the narrower of the two half-angles.
  const vertical = (fov * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * aspect);
  const distance = (radius / Math.sin(Math.min(vertical, horizontal))) * 1.1;
  const d = DIRECTIONS[preset];
  const length = Math.hypot(...d);
  const eye: Vec3 = [centre[0] + (d[0] / length) * distance, centre[1] + (d[1] / length) * distance, centre[2] + (d[2] / length) * distance];
  // From above, keep the plan's orientation: up the picture is up the plan (−z).
  const up: Vec3 = preset === 'top' ? [0, 0, -1] : [0, 1, 0];
  return { eye, target: centre, up, fov, near: Math.max(0.05, distance - 3 * radius), far: distance + 3 * radius };
}
