// Home document → Three.js scene. Every element's root object carries
// userData { id, kind } so editors can pick it.
import * as THREE from 'three';
import { catalogEntry, ceilingHeight, levelJoins, type Home, type Item, type Material } from '@fullscale/core';
import { buildFurniture } from './furniture.ts';
import { fitModel } from './models.ts';
import { buildOpeningFill, buildWallGeometry } from './walls.ts';

export interface BuildOptions {
  /** draw ceilings (off for dollhouse and top views) */
  ceilings?: boolean;
  /** only these level ids */
  levels?: string[];
  /** element ids to highlight */
  highlight?: string[];
  /**
   * A fresh copy of the loaded model for an item with `model` set, or nothing if the file
   * isn't loaded (or isn't on this computer); the catalogue shape is drawn instead.
   */
  models?: (item: Item) => THREE.Object3D | null | undefined;
}

export class MaterialCache {
  private byId = new Map<string, THREE.MeshStandardMaterial>();
  private byColor = new Map<string, THREE.MeshStandardMaterial>();
  readonly wallSide = new THREE.MeshStandardMaterial({ color: 0xe4e0d8, roughness: 0.9 });
  readonly frame = new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.5 });
  readonly door = new THREE.MeshStandardMaterial({ color: 0xd9cbb4, roughness: 0.6 });
  readonly glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f0, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false });
  readonly highlight = new THREE.Color(0x3b82f6);

  sync(materials: Material[]): void {
    for (const m of materials) {
      let mat = this.byId.get(m.id);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial();
        this.byId.set(m.id, mat);
      }
      mat.color.set(m.color);
      mat.roughness = m.roughness;
      mat.metalness = m.metalness;
      mat.transparent = m.opacity < 1;
      mat.opacity = m.opacity;
      mat.name = m.id;
      mat.needsUpdate = true;
    }
  }

  get(id: string | undefined, fallbackColor = '#cccccc'): THREE.MeshStandardMaterial {
    if (id) {
      const m = this.byId.get(id);
      if (m) return m;
    }
    return this.color(fallbackColor);
  }

  color(hex: string): THREE.MeshStandardMaterial {
    let m = this.byColor.get(hex);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
      this.byColor.set(hex, m);
    }
    return m;
  }

  dispose(): void {
    for (const m of [...this.byId.values(), ...this.byColor.values(), this.wallSide, this.frame, this.door, this.glass]) m.dispose();
  }
}

function floorShape(polygon: [number, number][]): THREE.Shape {
  // Shape lives in XY; after rotateX(-90°) the point (x, y) lands at (x, 0, -y), so we
  // feed (x, -z) to land on (x, 0, z).
  const s = new THREE.Shape();
  polygon.forEach(([x, z], i) => {
    if (i === 0) s.moveTo(x, -z);
    else s.lineTo(x, -z);
  });
  s.closePath();
  return s;
}

function floorGeometry(polygon: [number, number][]): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(floorShape(polygon));
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function flipWinding(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geo.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    index.needsUpdate = true;
  }
  geo.computeVertexNormals();
  return geo;
}

function tag(o: THREE.Object3D, id: string, kind: string): THREE.Object3D {
  o.userData = { id, kind };
  o.name = id;
  return o;
}

export function buildHomeScene(home: Home, cache: MaterialCache, opts: BuildOptions = {}): THREE.Group {
  cache.sync(home.materials);
  const root = new THREE.Group();
  root.name = 'home';
  const highlight = new Set(opts.highlight ?? []);

  for (const level of home.levels) {
    if (opts.levels && !opts.levels.includes(level.id)) continue;
    const lg = new THREE.Group();
    lg.name = `level:${level.id}`;
    lg.position.y = level.elevation;
    root.add(lg);

    for (const room of home.rooms.filter((r) => r.level === level.id)) {
      const geo = floorGeometry(room.polygon);
      const floor = new THREE.Mesh(geo, cache.get(room.floorMaterial, '#b08a5e'));
      floor.receiveShadow = true;
      lg.add(tag(floor, room.id, 'room'));
      if (opts.ceilings) {
        // Same outline, facing down: flip the triangle winding rather than mirroring the
        // object, so exporters and Blender see correct normals.
        const ceiling = new THREE.Mesh(flipWinding(floorGeometry(room.polygon)), cache.get(room.ceilingMaterial, '#f7f6f2'));
        ceiling.position.y = ceilingHeight(home, room);
        lg.add(tag(ceiling, room.id, 'ceiling'));
      }
    }

    const joins = levelJoins(home, level.id);
    for (const hub of joins.hubs) {
      const geo = new THREE.ExtrudeGeometry(floorShape(hub), { depth: level.height, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      lg.add(new THREE.Mesh(geo, cache.wallSide));
    }
    for (const wall of home.walls.filter((w) => w.level === level.id)) {
      const { geometry, matrix } = buildWallGeometry(home, wall, joins);
      const mats = [cache.get(wall.materials.left, '#f1ede4'), cache.wallSide, cache.get(wall.materials.right, '#f1ede4')];
      const mesh = new THREE.Mesh(geometry, highlight.has(wall.id) ? mats.map((m) => highlighted(m, cache)) : mats);
      mesh.applyMatrix4(matrix);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      lg.add(tag(mesh, wall.id, 'wall'));
      for (const o of home.openings.filter((x) => x.wall === wall.id)) {
        const fill = buildOpeningFill(wall, o, { frame: cache.frame, glass: cache.glass, door: cache.door });
        if (highlight.has(o.id))
          fill.traverse((c) => {
            if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).material = highlighted((c as THREE.Mesh).material as THREE.Material, cache);
          });
        lg.add(tag(fill, o.id, 'opening'));
      }
    }

    for (const item of home.items.filter((i) => i.level === level.id)) {
      const entry = catalogEntry(item.catalog);
      const model = item.model ? opts.models?.(item) : undefined;
      let g: THREE.Group;
      if (model && item.model) {
        g = fitModel(model, item.size, item.model).object;
        if (highlight.has(item.id)) {
          g.traverse((c) => {
            const mesh = c as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => highlighted(m, cache)) : highlighted(mesh.material, cache);
          });
        }
      } else {
        g = buildFurniture(item, (part) => {
          const m = item.materials[part] ? cache.get(item.materials[part]) : cache.color(entry.colors[part] ?? entry.colors[entry.parts[0]!] ?? '#bdbdbd');
          return highlight.has(item.id) ? highlighted(m, cache) : m;
        });
      }
      g.position.set(item.position[0], item.position[1], item.position[2]);
      g.rotation.y = (item.rotation * Math.PI) / 180;
      lg.add(tag(g, item.id, 'item'));
    }
  }
  return root;
}

const highlightCache = new WeakMap<THREE.Material, THREE.Material>();
function highlighted(m: THREE.Material, cache: MaterialCache): THREE.Material {
  let h = highlightCache.get(m);
  if (!h) {
    h = m.clone();
    if ('emissive' in h) {
      (h as THREE.MeshStandardMaterial).emissive = cache.highlight.clone();
      (h as THREE.MeshStandardMaterial).emissiveIntensity = 0.35;
    }
    highlightCache.set(m, h);
  }
  return h;
}

/** Free GPU memory for geometries (materials are owned by the cache; user models are
 *  owned by whoever loaded them). */
export function disposeScene(root: THREE.Object3D): void {
  if (root.userData.sharedGeometry) return;
  const mesh = root as THREE.Mesh;
  if (mesh.isMesh) mesh.geometry.dispose();
  for (const c of root.children) disposeScene(c);
}

/** The element id under a picked object, walking up to its tagged root. */
export function pickedElement(o: THREE.Object3D | null): { id: string; kind: string } | null {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (cur.userData?.id) return { id: cur.userData.id as string, kind: cur.userData.kind as string };
    cur = cur.parent;
  }
  return null;
}
