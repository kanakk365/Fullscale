// Simple procedural furniture built at the item's exact size. Each model fills its
// [width, height, depth] box exactly, with the front facing local +z.
// These stand in until real CC0 models are attached to catalogue entries.
import * as THREE from 'three';
import { catalogEntry, type Item } from '@fullscale/core';

export type PartMaterials = (part: string) => THREE.Material;

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

const cyl = (rTop: number, rBottom: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

function legs(g: THREE.Group, w: number, d: number, h: number, t: number, m: THREE.Material, inset = 0.03) {
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      g.add(box(t, h, t, m, sx * (w / 2 - inset - t / 2), 0, sz * (d / 2 - inset - t / 2)));
    }
}

export function buildFurniture(item: Item, mat: PartMaterials): THREE.Group {
  const g = new THREE.Group();
  const [w, h, d] = item.size;
  const entry = catalogEntry(item.catalog);
  const p = (name: string) => mat(name);
  switch (entry.shape) {
    case 'sofa':
    case 'armchair': {
      const legH = Math.min(0.1, h * 0.12);
      const arm = Math.min(0.18, w * 0.15);
      const seatH = h * 0.5;
      legs(g, w, d, legH, 0.05, p('legs'), 0.06);
      g.add(box(w, seatH - legH, d, p('body'), 0, legH, 0));
      g.add(box(w - 2 * arm, h - seatH, d * 0.24, p('body'), 0, seatH, -d / 2 + d * 0.12));
      g.add(box(arm, h * 0.72 - seatH + 0.0, d, p('body'), -w / 2 + arm / 2, seatH, 0));
      g.add(box(arm, h * 0.72 - seatH + 0.0, d, p('body'), w / 2 - arm / 2, seatH, 0));
      const seats = entry.shape === 'armchair' ? 1 : Math.max(2, Math.round((w - 2 * arm) / 0.65));
      const cw = (w - 2 * arm) / seats;
      for (let i = 0; i < seats; i++) {
        g.add(box(cw - 0.02, 0.12, d * 0.7, p('body'), -w / 2 + arm + cw * (i + 0.5), seatH, d * 0.1));
      }
      break;
    }
    case 'bed': {
      const frameH = Math.min(0.32, h * 0.35);
      g.add(box(w, frameH, d, p('frame')));
      g.add(box(w - 0.04, 0.22, d - 0.08, p('mattress'), 0, frameH, 0.02));
      g.add(box(w - 0.02, 0.07, d * 0.62, p('bedding'), 0, frameH + 0.2, d * 0.18));
      g.add(box(w, h, 0.06, p('frame'), 0, 0, -d / 2 + 0.03));
      for (const sx of entry.size[0] > 1.2 ? [-1, 1] : [0]) {
        g.add(box(Math.min(0.6, w * 0.4), 0.12, 0.35, p('mattress'), sx * w * 0.24, frameH + 0.22, -d / 2 + 0.3));
      }
      break;
    }
    case 'table':
    case 'desk': {
      const top = 0.04;
      g.add(box(w, top, d, p('top'), 0, h - top, 0));
      legs(g, w, d, h - top, 0.05, p('legs'));
      break;
    }
    case 'chair': {
      const seatY = Math.min(0.46, h * 0.53);
      legs(g, w, d, seatY - 0.04, 0.035, p('body'), 0.02);
      g.add(box(w, 0.05, d, p('body'), 0, seatY - 0.05, 0));
      g.add(box(w, h - seatY, 0.04, p('body'), 0, seatY, -d / 2 + 0.02));
      break;
    }
    case 'cabinet':
    case 'appliance': {
      g.add(box(w, h, d, p('body')));
      // A slim gap line on the front so doors read as doors.
      const line = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
      if (w > 0.7) g.add(box(0.006, h * 0.92, 0.004, line, 0, h * 0.04, d / 2 + 0.002));
      break;
    }
    case 'shelf': {
      const t = 0.025;
      g.add(box(t, h, d, p('body'), -w / 2 + t / 2));
      g.add(box(t, h, d, p('body'), w / 2 - t / 2));
      g.add(box(w, h, t, p('body'), 0, 0, -d / 2 + t / 2));
      const n = Math.max(2, Math.round(h / 0.38));
      for (let i = 0; i <= n; i++) g.add(box(w - 2 * t, t, d - t, p('body'), 0, (i * (h - t)) / n, t / 2));
      break;
    }
    case 'counter': {
      const top = 0.04;
      g.add(box(w - 0.004, h - top, d - 0.02, p('body'), 0, 0, -0.01));
      g.add(box(w, top, d, p('top'), 0, h - top, 0));
      break;
    }
    case 'toilet': {
      g.add(box(w, h * 0.5, d * 0.25, p('body'), 0, h * 0.5 - 0.0, -d / 2 + d * 0.125));
      g.add(cyl(w * 0.5, w * 0.38, h * 0.5, p('body'), 0, 0, d * 0.1));
      break;
    }
    case 'basin': {
      g.add(cyl(w * 0.12, w * 0.15, h - 0.16, p('body'), 0, 0, 0));
      g.add(box(w, 0.16, d, p('body'), 0, h - 0.16, 0));
      break;
    }
    case 'bathtub': {
      const wall = 0.06;
      g.add(box(w, h, wall, p('body'), 0, 0, -d / 2 + wall / 2));
      g.add(box(w, h, wall, p('body'), 0, 0, d / 2 - wall / 2));
      g.add(box(wall, h, d - 2 * wall, p('body'), -w / 2 + wall / 2));
      g.add(box(wall, h, d - 2 * wall, p('body'), w / 2 - wall / 2));
      g.add(box(w - 2 * wall, 0.08, d - 2 * wall, p('body')));
      break;
    }
    case 'shower': {
      g.add(box(w, 0.05, d, p('body')));
      const glass = new THREE.MeshPhysicalMaterial({ color: 0xdfeff2, transparent: true, opacity: 0.25, roughness: 0.05 });
      g.add(box(w, h - 0.05, 0.01, glass, 0, 0.05, d / 2 - 0.005));
      break;
    }
    case 'rug': {
      g.add(box(w, Math.max(0.005, h), d, p('body')));
      break;
    }
    case 'plant': {
      const potH = Math.min(0.35, h * 0.3);
      g.add(cyl(w * 0.32, w * 0.24, potH, p('pot'), 0, 0, 0));
      const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), p('leaves'));
      leaves.scale.set(w, h - potH, d);
      leaves.position.y = potH + (h - potH) / 2;
      g.add(leaves);
      break;
    }
    case 'lamp': {
      g.add(cyl(w * 0.35, w * 0.4, 0.03, p('body')));
      g.add(cyl(0.012, 0.012, h - 0.3, p('body'), 0, 0.03));
      g.add(cyl(w * 0.3, w * 0.5, 0.3, p('shade'), 0, h - 0.3));
      break;
    }
    default:
      g.add(box(w, h, d, p('body')));
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
