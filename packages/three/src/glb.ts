// A home as a binary glTF file (GLB), for Blender and any other 3D program. The scene is
// built by the same code the editor draws with, so every program sees the same walls at the
// same sizes. Each element's object carries its id in `extras.fullscale`, which is how the
// Blender link knows what a moved object is. The user's own models are never included:
// they are local-only, so items are drawn with their catalogue shapes.
//
// This writer covers what the scene builder makes (groups, meshes, standard materials) and
// runs anywhere, including Node without a browser.
import * as THREE from 'three';
import type { Home } from '@fullscale/core';
import { buildHomeScene, MaterialCache, type BuildOptions } from './scene.ts';

export interface GlbOptions extends Omit<BuildOptions, 'models' | 'highlight'> {}

/** Build the home's scene and write it as GLB. */
export function exportHomeGlb(home: Home, opts: GlbOptions = {}): Uint8Array {
  const cache = new MaterialCache();
  const scene = buildHomeScene(home, cache, opts);
  scene.updateMatrixWorld(true);
  try {
    return writeGlb(scene, { generator: 'Fullscale', extras: { fullscale: { home: home.id, units: 'm' } } });
  } finally {
    cache.dispose();
  }
}

interface Json {
  asset: { version: '2.0'; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[]; extras?: unknown }>;
  nodes: Array<Record<string, unknown>>;
  meshes: Array<{ primitives: Array<Record<string, unknown>> }>;
  materials: Array<Record<string, unknown>>;
  accessors: Array<Record<string, unknown>>;
  bufferViews: Array<Record<string, unknown>>;
  buffers: Array<{ byteLength: number }>;
}

const FLOAT = 5126;
const UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

/** Write a three.js object tree as GLB. */
export function writeGlb(root: THREE.Object3D, opts: { generator: string; extras?: unknown }): Uint8Array {
  const json: Json = {
    asset: { version: '2.0', generator: opts.generator },
    scene: 0,
    scenes: [{ nodes: [], ...(opts.extras ? { extras: opts.extras } : {}) }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const materialIndex = new Map<THREE.Material, number>();
  const meshIndex = new Map<string, number>();

  const addView = (data: Float32Array | Uint32Array, target: number): number => {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, target });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    // Keep every view 4-byte aligned.
    const pad = (4 - (bytes.byteLength % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      byteLength += pad;
    }
    return json.bufferViews.length - 1;
  };

  const addAttribute = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number, withBounds: boolean): number => {
    const data = new Float32Array(attr.count * size);
    for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) data[i * size + k] = attr.getComponent(i, k);
    const accessor: Record<string, unknown> = { bufferView: addView(data, ARRAY_BUFFER), componentType: FLOAT, count: attr.count, type: size === 2 ? 'VEC2' : 'VEC3' };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < attr.count; i++) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k]!, data[i * 3 + k]!);
          max[k] = Math.max(max[k]!, data[i * 3 + k]!);
        }
      }
      Object.assign(accessor, { min, max });
    }
    json.accessors.push(accessor);
    return json.accessors.length - 1;
  };

  const addIndices = (indices: number[]): number => {
    json.accessors.push({ bufferView: addView(Uint32Array.from(indices), ELEMENT_ARRAY_BUFFER), componentType: UNSIGNED_INT, count: indices.length, type: 'SCALAR' });
    return json.accessors.length - 1;
  };

  const addMaterial = (m: THREE.Material): number => {
    const known = materialIndex.get(m);
    if (known !== undefined) return known;
    const std = m as THREE.MeshStandardMaterial;
    const color = std.color ?? new THREE.Color(1, 1, 1);
    const opacity = m.transparent ? m.opacity : 1;
    json.materials.push({
      name: m.name || undefined,
      pbrMetallicRoughness: { baseColorFactor: [color.r, color.g, color.b, opacity], metallicFactor: std.metalness ?? 0, roughnessFactor: std.roughness ?? 1 },
      ...(opacity < 1 ? { alphaMode: 'BLEND' } : {}),
      ...(m.side === THREE.DoubleSide ? { doubleSided: true } : {}),
    });
    materialIndex.set(m, json.materials.length - 1);
    return json.materials.length - 1;
  };

  const addMesh = (mesh: THREE.Mesh): number | undefined => {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position || position.count === 0) return undefined;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const key = `${geometry.uuid}|${materials.map((m) => m.uuid).join(',')}`;
    const cached = meshIndex.get(key);
    if (cached !== undefined) return cached;

    const attributes: Record<string, number> = { POSITION: addAttribute(position, 3, true) };
    const normal = geometry.getAttribute('normal');
    if (normal) attributes.NORMAL = addAttribute(normal, 3, false);
    const uv = geometry.getAttribute('uv');
    if (uv) attributes.TEXCOORD_0 = addAttribute(uv, 2, false);

    const index = geometry.getIndex();
    const all = index ? Array.from({ length: index.count }, (_, i) => index.getX(i)) : Array.from({ length: position.count }, (_, i) => i);
    const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: all.length, materialIndex: 0 }];
    const primitives = groups
      .map((g) => ({ indices: all.slice(g.start, Math.min(all.length, g.start + g.count)), material: materials[g.materialIndex ?? 0] ?? materials[0]! }))
      .filter((p) => p.indices.length > 0)
      .map((p) => ({ attributes, indices: addIndices(p.indices), material: addMaterial(p.material) }));
    json.meshes.push({ primitives });
    meshIndex.set(key, json.meshes.length - 1);
    return json.meshes.length - 1;
  };

  const addNode = (object: THREE.Object3D): number => {
    const node: Record<string, unknown> = {};
    if (object.name) node.name = object.name;
    const { position: p, quaternion: q, scale: s } = object;
    if (p.x || p.y || p.z) node.translation = [p.x, p.y, p.z];
    if (q.x || q.y || q.z || q.w !== 1) node.rotation = [q.x, q.y, q.z, q.w];
    if (s.x !== 1 || s.y !== 1 || s.z !== 1) node.scale = [s.x, s.y, s.z];
    if (object.userData?.id) node.extras = { fullscale: { id: object.userData.id, kind: object.userData.kind } };
    if (object.userData?.hinge) node.extras = { fullscale: { hinge: object.userData.hinge } };
    const mesh = (object as THREE.Mesh).isMesh ? addMesh(object as THREE.Mesh) : undefined;
    if (mesh !== undefined) node.mesh = mesh;
    json.nodes.push(node);
    const index = json.nodes.length - 1;
    const children = object.children.filter((c) => c.visible).map(addNode);
    if (children.length) node.children = children;
    return index;
  };

  json.scenes[0]!.nodes.push(addNode(root));
  json.buffers.push({ byteLength });
  return pack(json, chunks, byteLength);
}

function pack(json: Json, chunks: Uint8Array[], binLength: number): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(text, 20);
  out.fill(0x20, 20 + text.byteLength, 20 + jsonLength); // JSON is padded with spaces
  let at = 20 + jsonLength;
  view.setUint32(at, binLength, true);
  view.setUint32(at + 4, 0x004e4942, true); // "BIN"
  at += 8;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
