// The user's own 3D models, in the local models folder (never committed or shared). Each
// model's size is read from its glTF data, which must state the bounds of every mesh's
// positions, so items can be fitted to their true size without loading the model.
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ModelFileSchema } from '@fullscale/core';

export interface LocalModel {
  /** path inside the models folder, with "/" separators */
  file: string;
  bytes: number;
  /** the model's bounding box [x, y, z] in its own units, when it could be read */
  nativeSize?: [number, number, number];
  /** why the size could not be read */
  problem?: string;
}

/** Models in a folder, sorted by path. Hidden files and folders are skipped. */
export function listModels(dir: string, limit = 500): LocalModel[] {
  const found: LocalModel[] = [];
  const walk = (folder: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= limit || e.name.startsWith('.')) continue;
      const full = join(folder, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(glb|gltf)$/i.test(e.name)) {
        const file = relative(dir, full).split(sep).join('/');
        if (!ModelFileSchema.safeParse(file).success) continue;
        found.push(describeModel(dir, file));
      }
    }
  };
  walk(dir);
  return found;
}

export function describeModel(dir: string, file: string): LocalModel {
  const full = join(dir, ...file.split('/'));
  const bytes = statSync(full).size;
  try {
    return { file, bytes, nativeSize: gltfSize(readFileSync(full), file.toLowerCase().endsWith('.glb')) };
  } catch (err) {
    return { file, bytes, problem: (err as Error).message };
  }
}

type Matrix = number[];

interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface Gltf {
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  nodes?: GltfNode[];
  meshes?: Array<{ primitives: Array<{ attributes: Record<string, number> }> }>;
  accessors?: Array<{ min?: number[]; max?: number[] }>;
}

/** The size [x, y, z] of a glTF model's default scene, from the bounds of its meshes. */
export function gltfSize(data: Buffer, binary: boolean): [number, number, number] {
  const gltf = (binary ? glbJson(data) : JSON.parse(data.toString('utf8'))) as Gltf;
  const nodes = gltf.nodes ?? [];
  const isChild = new Set(nodes.flatMap((n) => n.children ?? []));
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !isChild.has(i));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const visit = (index: number, parent: Matrix, depth: number) => {
    const node = nodes[index];
    if (!node || depth > 64) return;
    const world = multiply(parent, localMatrix(node));
    for (const primitive of node.mesh !== undefined ? (gltf.meshes?.[node.mesh]?.primitives ?? []) : []) {
      const accessor = gltf.accessors?.[primitive.attributes.POSITION ?? -1];
      if (!accessor?.min || !accessor.max) continue;
      for (const corner of corners(accessor.min, accessor.max)) {
        const p = transform(world, corner);
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, p[k]!);
          max[k] = Math.max(max[k]!, p[k]!);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world, depth + 1);
  };
  for (const root of roots) visit(root, IDENTITY, 0);
  if (!Number.isFinite(min[0])) throw new Error('the model has no mesh with stated bounds');
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

function glbJson(data: Buffer): unknown {
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  if (data.readUInt32LE(4) !== 2) throw new Error(`GLB version ${data.readUInt32LE(4)} is not supported`);
  const length = data.readUInt32LE(12);
  if (data.readUInt32LE(16) !== 0x4e4f534a || 20 + length > data.length) throw new Error('the GLB has no JSON chunk');
  return JSON.parse(data.subarray(20, 20 + length).toString('utf8'));
}

// 4 × 4 matrices in glTF's column-major order.
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function localMatrix(node: GltfNode): Matrix {
  if (node.matrix?.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // Rotation from a unit quaternion, scaled per axis, then translated.
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!,
    2 * (x! * y! + z! * w!) * sx!,
    2 * (x! * z! - y! * w!) * sx!,
    0,
    2 * (x! * y! - z! * w!) * sy!,
    (1 - 2 * (x! * x! + z! * z!)) * sy!,
    2 * (y! * z! + x! * w!) * sy!,
    0,
    2 * (x! * z! + y! * w!) * sz!,
    2 * (y! * z! - x! * w!) * sz!,
    (1 - 2 * (x! * x! + y! * y!)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function transform(m: Matrix, p: number[]): number[] {
  return [0, 1, 2].map((row) => m[row]! * p[0]! + m[4 + row]! * p[1]! + m[8 + row]! * p[2]! + m[12 + row]!);
}

function corners(min: number[], max: number[]): number[][] {
  const out: number[][] = [];
  for (const x of [min[0]!, max[0]!]) for (const y of [min[1]!, max[1]!]) for (const z of [min[2]!, max[2]!]) out.push([x, y, z]);
  return out;
}
