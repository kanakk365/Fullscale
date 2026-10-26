// Home document → Three.js scene. Every element's root object carries
// userData { id, kind } so editors can pick it.
import * as THREE from 'three';
import { catalogEntry, ceilingHeight, itemLight, levelJoins, partKind, type Home, type Item, type ItemLight, type Material, type MaterialKind } from '@fullscale/core';
import { buildFurniture, type Emitter } from './furniture.ts';
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
  /** A picture file in the home's folder as a texture (it may fill in later), for materials
   *  with an image; without it, those materials show their colour. */
  pictures?: (file: string) => THREE.Texture | null | undefined;
}

export class MaterialCache {
  private byId = new Map<string, THREE.MeshStandardMaterial>();
  private byColor = new Map<string, THREE.MeshStandardMaterial>();
  private glowing = new Map<string, THREE.MeshStandardMaterial>();
  readonly wallSide = kindOf(new THREE.MeshStandardMaterial({ color: 0xe4e0d8, roughness: 0.9 }), 'paint');
  readonly frame = kindOf(new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.5 }), 'paint');
  readonly door = kindOf(new THREE.MeshStandardMaterial({ color: 0xd9cbb4, roughness: 0.6 }), 'wood');
  readonly glass = kindOf(new THREE.MeshPhysicalMaterial({ color: 0xcfe6f0, roughness: 0.05, transparent: true, opacity: 0.3, depthWrite: false }), 'glass');
  readonly highlight = new THREE.Color(0x3b82f6);

  sync(materials: Material[], pictures?: BuildOptions['pictures']): void {
    for (const m of materials) {
      let mat = this.byId.get(m.id);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial();
        this.byId.set(m.id, mat);
      }
      const picture = m.image ? pictures?.(m.image.file) : null;
      if (picture && m.image) {
        // Its own copy of the texture: how it repeats belongs to this material.
        const map = mat.map?.source === picture.source ? mat.map : picture.clone();
        map.colorSpace = THREE.SRGBColorSpace;
        const wrap = m.image.fit === 'mirror' ? THREE.MirroredRepeatWrapping : m.image.fit === 'repeat' ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
        map.wrapS = map.wrapT = wrap;
        // Repeating pictures are laid out in metres (see metreUVs), so they repeat at their size.
        if (m.image.fit === 'stretch') map.repeat.set(1, 1);
        else map.repeat.set(1 / (m.image.width ?? 1), 1 / (m.image.height ?? m.image.width ?? 1));
        map.needsUpdate = true;
        mat.map = map;
        mat.color.set('#ffffff');
      } else {
        mat.map = null;
        mat.color.set(m.color);
      }
      mat.roughness = m.roughness;
      mat.metalness = m.metalness;
      mat.transparent = m.opacity < 1;
      mat.opacity = m.opacity;
      // See-through materials (glass) mustn't hide what is behind them.
      mat.depthWrite = m.opacity >= 1;
      mat.name = m.id;
      mat.userData.fullscale = { kind: m.kind, ...(m.tileSize ? { tileSize: m.tileSize } : {}), ...(m.image ? { image: m.image } : {}) };
      mat.needsUpdate = true;
    }
  }

  get(id: string | undefined, fallbackColor = '#cccccc', fallbackKind: MaterialKind = 'paint'): THREE.MeshStandardMaterial {
    if (id) {
      const m = this.byId.get(id);
      if (m) return m;
    }
    return this.color(fallbackColor, fallbackKind);
  }

  /** A plain colour, marked with what it's made of so renderers can give it a surface. */
  color(hex: string, kind: MaterialKind = 'other'): THREE.MeshStandardMaterial {
    const key = `${hex}|${kind}`;
    let m = this.byColor.get(key);
    if (!m) {
      m = kindOf(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 }), kind);
      this.byColor.set(key, m);
    }
    return m;
  }

  /** A lit lamp's glowing part: its own material, shining in the light's colour. Renderers
   *  that light the room take the light itself from the item's light point. */
  glow(base: THREE.MeshStandardMaterial, kelvin: number, screen = false): THREE.MeshStandardMaterial {
    const key = `${base.uuid}|${kelvin}|${screen}`;
    let m = this.glowing.get(key);
    if (!m) {
      m = base.clone();
      // A screen showing a picture glows with the picture; a bulb with its light's colour.
      if (base.map) {
        m.emissive = new THREE.Color('#ffffff');
        m.emissiveMap = base.map;
      } else m.emissive = screen ? base.color.clone() : kelvinColor(kelvin);
      m.emissiveIntensity = 1;
      // A screen glows with what it shows (its picture, or else its colour), not white.
      m.userData.fullscale = { ...base.userData.fullscale, glow: kelvin, ...(screen ? { screen: true } : {}) };
      this.glowing.set(key, m);
    }
    return m;
  }

  dispose(): void {
    for (const m of [...this.byId.values(), ...this.byColor.values(), ...this.glowing.values(), this.wallSide, this.frame, this.door, this.glass]) m.dispose();
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
  cache.sync(home.materials, opts.pictures);
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
      const floor = new THREE.Mesh(geo, cache.get(room.floorMaterial, '#b08a5e', 'wood'));
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
        const fill = buildOpeningFill(wall, o, {
          frame: o.materials?.frame ? cache.get(o.materials.frame) : cache.frame,
          glass: o.materials?.glass ? cache.get(o.materials.glass) : cache.glass,
          door: o.materials?.leaf ? cache.get(o.materials.leaf) : cache.door,
          // A niche's inside takes its frame material, else the paint of the face it opens on.
          inside: o.materials?.frame ? cache.get(o.materials.frame) : cache.get(wall.materials[o.face === 'right' ? 'right' : 'left'], '#f1ede4'),
          metal: cache.color('#9c9a96', 'metal'),
        });
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
        const light = itemLight(item);
        g = buildFurniture(item, (part) => {
          let m = item.materials[part] ? cache.get(item.materials[part]) : cache.color(entry.colors[part] ?? entry.colors[entry.parts[0]!] ?? '#bdbdbd', partKind(entry, part));
          if (light?.on && part === light.part) m = cache.glow(m, light.kelvin, part === 'screen');
          return highlight.has(item.id) ? highlighted(m, cache) : m;
        });
      }
      markLight(g, item);
      g.position.set(item.position[0], item.position[1], item.position[2]);
      g.rotation.y = (item.rotation * Math.PI) / 180;
      lg.add(tag(g, item.id, 'item'));
    }
  }
  layPictures(root);
  return root;
}

/** Repeating pictures (a fabric print, tiles) are laid out in metres on every surface that
 *  shows one, so they repeat at their real size whatever the shape. */
function layPictures(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || root.userData.sharedGeometry) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tiled = materials.some((m) => {
      const image = m?.userData?.fullscale?.image as { fit?: string } | undefined;
      return image && image.fit !== 'stretch';
    });
    if (tiled) metreUVs(mesh.geometry);
  });
}

/** Texture coordinates in metres, projected from whichever side each face faces: tops and
 *  bottoms across x and z, sides across their width and up their height. */
export function metreUVs(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  let normal = geometry.getAttribute('normal');
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute('normal');
  }
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    const [nx, ny, nz] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i)), Math.abs(normal.getZ(i))];
    if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = -z;
    } else if (nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** What a light item gives off, on the object it shines from: `userData.light` holds its
 *  shape, colour, brightness and whether it's on. Items drawn with the person's own model
 *  have no light point of their own, so theirs is the middle of the item. */
export interface LightPoint extends Emitter, ItemLight {}

function markLight(g: THREE.Group, item: Item): void {
  const light = itemLight(item);
  if (!light) return;
  let point = g.getObjectByName('light');
  if (!point) {
    point = new THREE.Object3D();
    point.name = 'light';
    point.position.set(0, item.size[1] / 2, 0);
    point.userData.emitter = { shape: 'point', size: 0.03, facing: [0, -1, 0] } satisfies Emitter;
    g.add(point);
  }
  const { emitter, ...rest } = point.userData as { emitter: Emitter };
  point.userData = { ...rest, light: { ...emitter, ...light } satisfies LightPoint };
}

/** The colour of a light of this colour temperature (a close fit to a glowing body's colour). */
export function kelvinColor(kelvin: number): THREE.Color {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (v: number) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color().setRGB(clamp(r), clamp(g), clamp(b), THREE.SRGBColorSpace);
}

function kindOf<M extends THREE.Material>(m: M, kind: MaterialKind): M {
  m.userData.fullscale = { kind };
  return m;
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
