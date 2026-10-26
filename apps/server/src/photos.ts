// The photos of the home's phone captures, for agents to look at and to cut pictures from.
//
// Photos are stored as the camera's sensor took them, often on their side. Agents see them
// upright and give points in upright pixels (from the top-left corner); this module turns
// those back. Each photo's camera is known (its pose and lens), and the capture's place in
// the home (`toHome`), so a point on a photo is a ray in the home: it says what the photo
// shows (the element the ray meets) and how big a surface really is.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PhotoRecordSchema, readJsonLines, type PhotoRecord } from '@fullscale/capture';
import { captureToHomeMatrix, EditError, type CaptureRef, type Home, type Vec3 } from '@fullscale/core';
import { buildHomeScene, MaterialCache, pickedElement } from '@fullscale/three';
import jpeg from 'jpeg-js';
import * as THREE from 'three';
import { insideFolder } from './files.ts';

export interface Photo {
  capture: CaptureRef;
  record: PhotoRecord;
  /** the photo's file on disk */
  file: string;
  /** quarter turns clockwise that stand the stored picture upright */
  turns: 0 | 1 | 2 | 3;
}

/** The photos of the home's imported phone captures (or one of them). */
export function capturePhotos(home: Home, homeDir: string, captureId?: string): { photos: Photo[]; problems: string[] } {
  const captures = home.captures.filter((c) => c.kind === 'phone-capture' && (!captureId || c.id === captureId));
  if (captureId && !captures.length) throw new EditError('not_found', `No phone capture "${captureId}". get_home lists the captures.`, { id: captureId, kind: 'capture' });
  const photos: Photo[] = [];
  const problems: string[] = [];
  for (const capture of captures) {
    const dir = insideFolder(homeDir, capture.path);
    const index = dir ? join(dir, 'photos', 'index.jsonl') : null;
    if (!dir || !index || !existsSync(index)) {
      problems.push(`Capture ${capture.id} has no photos (photos/index.jsonl).`);
      continue;
    }
    const read = readJsonLines(readFileSync(index, 'utf8'), PhotoRecordSchema);
    problems.push(...read.problems.map((p) => `Capture ${capture.id} photos: ${p}.`));
    for (const record of read.records) {
      const file = insideFolder(dir, record.file);
      if (!file || !existsSync(file)) continue;
      photos.push({ capture, record, file, turns: uprightTurns(record.pose) });
    }
  }
  return { photos, problems };
}

export function findPhoto(home: Home, homeDir: string, captureId: string | undefined, photoId: string): Photo {
  const { photos } = capturePhotos(home, homeDir, captureId);
  const found = photos.filter((p) => p.record.id === photoId);
  if (!found.length) throw new EditError('not_found', `No photo "${photoId}"${captureId ? ` in ${captureId}` : ''}. view_photo without a photo lists them.`, { id: photoId, kind: 'photo' });
  if (found.length > 1) throw new EditError('invalid_input', `Photo "${photoId}" is in more than one capture; say which (capture).`, { captures: found.map((p) => p.capture.id) });
  return found[0]!;
}

// ---------- upright pictures ----------

/** Quarter turns clockwise that bring the world's up to the top of the picture. The pose is
 *  the camera's (column-major; x right and y up on the stored picture). */
export function uprightTurns(pose: readonly number[]): 0 | 1 | 2 | 3 {
  const right = pose[1]!; // how much the picture's right points up
  const up = pose[5]!; // how much the picture's up points up
  if (Math.abs(up) >= Math.abs(right)) return up >= 0 ? 0 : 2;
  return right < 0 ? 1 : 3;
}

/** A photo's size standing upright. */
export function uprightSize(p: Photo): [number, number] {
  const { width, height } = p.record;
  return p.turns % 2 ? [height, width] : [width, height];
}

/** Upright pixels → stored pixels (both from the top-left corner). */
export function toStored(p: Photo, [x, y]: [number, number]): [number, number] {
  const { width: w, height: h } = p.record;
  switch (p.turns) {
    case 1:
      return [y, h - x];
    case 2:
      return [w - x, h - y];
    case 3:
      return [w - y, x];
    default:
      return [x, y];
  }
}

/** The SVG transform that draws the stored picture upright, at scale 1. */
export function uprightTransform(p: Photo): string {
  const { width: w, height: h } = p.record;
  return ['', `translate(${h} 0) rotate(90)`, `translate(${w} ${h}) rotate(180)`, `translate(0 ${w}) rotate(270)`][p.turns]!;
}

// ---------- the camera in the home ----------

export interface PhotoCamera {
  eye: Vec3;
  /** a point 2 m ahead, along the middle of the picture */
  target: Vec3;
  /** the upright picture's vertical field of view, degrees */
  fov: number;
  /** a ray in the home through a stored pixel */
  ray(stored: [number, number]): THREE.Ray;
  /** where a point in the home is on the stored picture, or null when it's behind the camera */
  project(point: THREE.Vector3): [number, number] | null;
}

/** Where a photo was taken from, in the home; null when its capture isn't placed in the home. */
export function photoCamera(home: Home, p: Photo): PhotoCamera | null {
  const toHome = p.capture.toHome;
  if (!toHome) return null;
  const elevation = home.levels.find((l) => l.id === toHome.level)?.elevation ?? 0;
  const world = new THREE.Matrix4().fromArray(captureToHomeMatrix(toHome, elevation)).multiply(new THREE.Matrix4().fromArray(p.record.pose));
  const origin = new THREE.Vector3().setFromMatrixPosition(world);
  const { fx, fy, cx, cy } = p.record.intrinsics;
  const ray = ([u, v]: [number, number]) => {
    // The camera looks down its -z with y up; stored pixels run right and down.
    const dir = new THREE.Vector3((u - cx) / fx, -(v - cy) / fy, -1).transformDirection(world);
    return new THREE.Ray(origin.clone(), dir);
  };
  const toCamera = world.clone().invert();
  const project = (point: THREE.Vector3): [number, number] | null => {
    const c = point.clone().applyMatrix4(toCamera);
    if (c.z > -1e-6) return null;
    return [cx + (fx * c.x) / -c.z, cy - (fy * c.y) / -c.z];
  };
  const ahead = ray([cx, cy]).direction;
  const halfUp = p.turns % 2 ? p.record.width / 2 / fx : p.record.height / 2 / fy;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    eye: [r3(origin.x), r3(origin.y), r3(origin.z)],
    target: [r3(origin.x + ahead.x * 2), r3(origin.y + ahead.y * 2), r3(origin.z + ahead.z * 2)],
    fov: Math.round(((2 * Math.atan(halfUp) * 180) / Math.PI) * 10) / 10,
    ray,
    project,
  };
}

/** The home's model, to find what a ray from a photo meets. */
export class ModelRays {
  private readonly root: THREE.Object3D;
  private readonly cache = new MaterialCache();
  private readonly caster = new THREE.Raycaster();

  constructor(home: Home) {
    this.root = buildHomeScene(home, this.cache, { ceilings: true });
    this.root.updateMatrixWorld(true);
  }

  /** The first thing the ray meets: the element, the point, the surface's facing (in the
   *  home) and the element's own object, or null. */
  hit(ray: THREE.Ray): { id: string; kind: string; point: THREE.Vector3; distance: number; normal: THREE.Vector3; element: THREE.Object3D } | null {
    this.caster.ray.copy(ray);
    this.caster.far = 30;
    for (const h of this.caster.intersectObject(this.root, true)) {
      const element = pickedElement(h.object);
      let root: THREE.Object3D | null = h.object;
      while (root && !root.userData?.id) root = root.parent;
      if (!element || !root) continue;
      const normal = (h.face?.normal ?? new THREE.Vector3(0, 1, 0)).clone().transformDirection(h.object.matrixWorld);
      if (normal.dot(ray.direction) > 0) normal.negate();
      return { ...element, point: h.point, distance: h.distance, normal, element: root };
    }
    return null;
  }

  /**
   * A real rectangle `width` × `height` metres on the surface a photo shows at a stored pixel,
   * squared to the surface: on a floor, a bed or a table along the element's own sides; on a
   * wall, a door or a frame, level and upright. Its corners on the picture, top-left first,
   * and what each corner's ray really meets (something in front of the surface, or nothing).
   */
  rectangleAt(camera: PhotoCamera, stored: [number, number], width: number, height: number) {
    const h = this.hit(camera.ray(stored));
    if (!h) return null;
    const up = new THREE.Vector3(0, 1, 0);
    let across: THREE.Vector3;
    let along: THREE.Vector3;
    if (Math.abs(h.normal.y) > 0.7) {
      // Lying flat: along the element's own x, and "up" the picture away from the camera.
      across = new THREE.Vector3(1, 0, 0).transformDirection(h.element.matrixWorld).setY(0).normalize();
      along = new THREE.Vector3().crossVectors(h.normal, across).normalize();
      const away = camera.ray(stored).direction.clone().setY(0);
      if (along.dot(away) < 0) {
        along.negate();
        across.negate();
      }
      if (new THREE.Vector3().crossVectors(across, along).dot(h.normal) < 0) across.negate();
    } else {
      across = new THREE.Vector3().crossVectors(up, h.normal).normalize();
      along = up.clone();
    }
    const at = (sx: number, sy: number) =>
      h.point
        .clone()
        .addScaledVector(across, (sx * width) / 2)
        .addScaledVector(along, (sy * height) / 2);
    const corners3d = [at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)];
    const corners = corners3d.map((c) => camera.project(c));
    const blocked = corners3d.map((c, i) => {
      const seen = corners[i] ? this.hit(camera.ray(corners[i]!)) : null;
      return !seen || seen.point.distanceTo(c) > 0.03 ? (seen?.id ?? 'nothing') : null;
    });
    return { on: h.id, corners, blocked };
  }

  /** What a photo shows: the elements a grid of rays meets, most seen first. */
  sees(p: Photo, camera: PhotoCamera): Array<{ id: string; share: number; distance: number }> {
    const counts = new Map<string, { n: number; distance: number }>();
    const steps = 6;
    for (let i = 0; i < steps; i++)
      for (let j = 0; j < steps; j++) {
        const h = this.hit(camera.ray([((i + 0.5) / steps) * p.record.width, ((j + 0.5) / steps) * p.record.height]));
        if (!h) continue;
        const c = counts.get(h.id) ?? { n: 0, distance: 0 };
        counts.set(h.id, { n: c.n + 1, distance: c.distance + h.distance });
      }
    return [...counts.entries()].map(([id, c]) => ({ id, share: c.n / (steps * steps), distance: Math.round((c.distance / c.n) * 100) / 100 })).sort((a, b) => b.share - a.share);
  }

  dispose(): void {
    this.cache.dispose();
  }
}

// ---------- cutting a picture out of a photo ----------

export interface Cut {
  jpeg: Buffer;
  width: number;
  height: number;
  /** the average colour, #rrggbb */
  colour: string;
}

/**
 * Cut the patch inside four stored points (its top-left, top-right, bottom-right and
 * bottom-left as it should look) out of a photo, straightened into a rectangle `width` ×
 * `height` pixels.
 */
export function cutPatch(file: string, quad: Array<[number, number]>, width: number, height: number, seamless = false): Cut {
  const source = jpeg.decode(readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 1024 });
  const h = squareToQuad(quad);
  const out = new Uint8Array(width * height * 4);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [u, v] = h((x + 0.5) / width, (y + 0.5) / height);
      const px = sample(source, u - 0.5, v - 0.5);
      const at = (y * width + x) * 4;
      out[at] = px[0];
      out[at + 1] = px[1];
      out[at + 2] = px[2];
      out[at + 3] = 255;
      r += px[0];
      g += px[1];
      b += px[2];
    }
  }
  const n = width * height;
  const hex = (v: number) =>
    Math.round(v / n)
      .toString(16)
      .padStart(2, '0');
  const data = seamless ? tileable(out, width, height) : out;
  return { jpeg: Buffer.from(jpeg.encode({ data, width, height }, 90).data), width, height, colour: `#${hex(r)}${hex(g)}${hex(b)}` };
}

/**
 * Make a picture repeat without seams, one direction at a time: near its left and right
 * edges it fades into a copy of itself moved by half its width, whose edges meet exactly and
 * whose own seam falls in the middle, where the original shows; then the same up and down.
 * The middle stays as photographed.
 */
export function tileable(pixels: Uint8Array, width: number, height: number, margin = 0.18): Uint8Array {
  const fade = (i: number, n: number) => Math.min(1, Math.min(i + 0.5, n - i - 0.5) / (n * margin));
  const across = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const w = fade(x, width);
      const at = (y * width + x) * 4;
      const from = (y * width + ((x + Math.floor(width / 2)) % width)) * 4;
      for (let c = 0; c < 3; c++) across[at + c] = Math.round(pixels[at + c]! * w + pixels[from + c]! * (1 - w));
      across[at + 3] = 255;
    }
  const out = new Uint8Array(pixels.length);
  for (let y = 0; y < height; y++) {
    const w = fade(y, height);
    const sy = (y + Math.floor(height / 2)) % height;
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const from = (sy * width + x) * 4;
      for (let c = 0; c < 3; c++) out[at + c] = Math.round(across[at + c]! * w + across[from + c]! * (1 - w));
      out[at + 3] = 255;
    }
  }
  return out;
}

/** The projective map from the unit square to a quad (corners in order (0,0), (1,0), (1,1),
 *  (0,1)). */
export function squareToQuad(q: Array<[number, number]>): (s: number, t: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = det ? (dx3 * dy2 - dx2 * dy3) / det : 0;
  const hh = det ? (dx1 * dy3 - dx3 * dy1) / det : 0;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + hh * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + hh * y3;
  return (s, t) => {
    const w = g * s + hh * t + 1;
    return [(a * s + b * t + x0) / w, (d * s + e * t + y0) / w];
  };
}

function sample(img: { width: number; height: number; data: Uint8Array }, x: number, y: number): [number, number, number] {
  const cx = Math.min(img.width - 1, Math.max(0, x));
  const cy = Math.min(img.height - 1, Math.max(0, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(img.width - 1, x0 + 1);
  const y1 = Math.min(img.height - 1, y0 + 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const at = (xx: number, yy: number, c: number) => img.data[(yy * img.width + xx) * 4 + c]!;
  const mix = (c: number) => (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) + (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy;
  return [mix(0), mix(1), mix(2)];
}
