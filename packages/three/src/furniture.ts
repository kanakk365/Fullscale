// Simple procedural furniture built at the item's exact size. Each model fills its
// [width, height, depth] box exactly, with the front facing local +z.
// These stand in until real CC0 models are attached to catalogue entries.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { catalogEntry, type Item } from '@fullscale/core';

export type PartMaterials = (part: string) => THREE.Material;

const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

/** A box with rounded edges and corners (radius `r`), standing on y like `box`. */
const rbox = (w: number, h: number, d: number, r: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const [bw, bh, bd] = [Math.max(w, 0.002), Math.max(h, 0.002), Math.max(d, 0.002)];
  const radius = Math.max(0.0005, Math.min(r, Math.min(bw, bh, bd) / 2 - 0.0005));
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, bd, 3, radius), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

/** A slab curved around a vertical axis, its sides coming forward (towards +z) like a chair's
 *  back; centred on its own origin. `sag` is how far the sides come forward. */
function curvedSlab(w: number, h: number, t: number, sag: number, m: THREE.Material): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, t, 16, 2, 1);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2);
    p.setZ(i, p.getZ(i) + sag * x * x - sag / 2);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, m);
}

const cyl = (rTop: number, rBottom: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 20) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
};

/** The same surface seen from the other side: for the inside of open shades. */
function inside(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const flipped = geo.clone();
  const index = flipped.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
  }
  const normal = flipped.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, -normal.getX(i), -normal.getY(i), -normal.getZ(i));
  return flipped;
}

/** An open shade (a lampshade): its outside and its inside, so it reads from any side and
 *  light leaves through the open ends. */
function shade(rTop: number, rBottom: number, h: number, m: THREE.Material, y: number): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, 28, 1, true);
  g.add(new THREE.Mesh(geo, m), new THREE.Mesh(inside(geo), m));
  g.position.y = y + h / 2;
  return g;
}

/** Where a light's glow comes from, for renderers that light the room with it: a point (a
 *  bulb), a line (a tube, lying along x), a disc (a ceiling light) or a panel (a screen),
 *  shining towards `facing`. */
export interface Emitter {
  shape: 'point' | 'line' | 'disc' | 'panel';
  /** a point's or disc's radius, a line's length, a panel's width */
  size: number;
  /** a panel's height */
  height?: number;
  facing: [number, number, number];
  /** the glowing part is a shade around the light, which keeps its shadow */
  shaded?: boolean;
}

function emit(g: THREE.Group, emitter: Emitter, x: number, y: number, z: number): void {
  const o = new THREE.Object3D();
  o.name = 'light';
  o.position.set(x, y, z);
  o.userData.emitter = emitter;
  g.add(o);
}

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
      // Soft, rounded upholstery: a base, a back, two arms and a seat cushion per seat.
      const legH = Math.min(0.1, h * 0.12);
      const arm = Math.min(0.18, w * 0.15);
      const seatH = h * 0.5;
      const soft = 0.04;
      legs(g, w, d, legH, 0.05, p('legs'), 0.06);
      g.add(rbox(w, seatH - legH - 0.1, d, soft, p('body'), 0, legH, 0));
      g.add(rbox(w - 2 * arm + 0.02, h - seatH + 0.1, d * 0.26, 0.06, p('body'), 0, seatH - 0.1, -d / 2 + d * 0.13));
      g.add(rbox(arm, h * 0.72 - legH, d, 0.06, p('body'), -w / 2 + arm / 2, legH, 0));
      g.add(rbox(arm, h * 0.72 - legH, d, 0.06, p('body'), w / 2 - arm / 2, legH, 0));
      const seats = entry.shape === 'armchair' ? 1 : Math.max(2, Math.round((w - 2 * arm) / 0.65));
      const cw = (w - 2 * arm) / seats;
      for (let i = 0; i < seats; i++) {
        g.add(rbox(cw - 0.01, 0.16, d * 0.72, 0.06, p('body'), -w / 2 + arm + cw * (i + 0.5), seatH - 0.1, d * 0.13));
      }
      break;
    }
    case 'bed': {
      // A base on short legs with a headboard; the mattress; a cover over it that hangs a
      // little down its sides; and pillows at the head.
      const legH = Math.min(0.08, h * 0.1);
      const baseTop = Math.min(0.3, h * 0.32);
      const board = Math.min(0.05, d * 0.04);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.06, legH, 0.06, p('frame'), sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06)));
      g.add(rbox(w, baseTop - legH, d - board, 0.01, p('frame'), 0, legH, board / 2));
      g.add(rbox(w, h, board, 0.015, p('frame'), 0, 0, -d / 2 + board / 2));
      const mattH = Math.max(0.05, Math.min(0.2, (h - baseTop) * 0.6));
      const mw = w - 0.06;
      const md = d - board - 0.04;
      const mz = board / 2;
      g.add(rbox(mw, mattH, md, 0.05, p('mattress'), 0, baseTop, mz));
      const cover = mattH * 0.75;
      g.add(rbox(mw + 0.02, cover + 0.01, md + 0.01, 0.06, p('bedding'), 0, baseTop + mattH - cover, mz + 0.005));
      const top = baseTop + mattH + 0.01;
      const pillowH = Math.min(0.13, h - top);
      if (pillowH > 0.03) {
        const n = w > 1.2 ? 2 : 1;
        const pw = Math.min(0.66, (mw - 0.08 * (n + 1)) / n);
        for (let i = 0; i < n; i++) {
          const x = n === 1 ? 0 : (i === 0 ? -1 : 1) * (pw / 2 + 0.04);
          g.add(rbox(pw, pillowH, 0.38, 0.06, p('pillows'), x, top - 0.01, -d / 2 + board + 0.24));
        }
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
      // The body stops just short of the front so the door gap sits inside the item's box.
      g.add(box(w, h, d - 0.004, p('body'), 0, 0, -0.002));
      // A slim gap line on the front so doors read as doors.
      const line = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.8 });
      if (w > 0.7) g.add(box(0.006, h * 0.92, 0.004, line, 0, h * 0.04, d / 2 - 0.002));
      break;
    }
    case 'office-chair': {
      // An ergonomic swivel chair: a five-star base on castors, a gas lift, a padded seat, a
      // curved mesh back with a lumbar pad, a headrest, and arms.
      const r = Math.min(w, d) / 2;
      const castor = Math.min(0.05, h * 0.05);
      const hubY = castor + 0.02;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        const reach = r - castor / 2;
        const spoke = rbox(reach, 0.035, 0.045, 0.012, p('frame'), (Math.cos(a) * reach) / 2, hubY - 0.0175, (Math.sin(a) * reach) / 2);
        spoke.rotation.y = -a;
        g.add(spoke);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(castor / 2, castor / 2, castor * 0.7, 16), p('body'));
        wheel.rotation.set(Math.PI / 2, 0, 0);
        wheel.rotateZ(a);
        wheel.position.set(Math.cos(a) * reach, castor / 2, Math.sin(a) * reach);
        g.add(wheel);
      }
      const seatY = Math.min(0.5, h * 0.4);
      g.add(cyl(0.03, 0.035, 0.12, p('frame'), 0, hubY));
      g.add(cyl(0.022, 0.022, Math.max(0.01, seatY - 0.1 - hubY), p('frame'), 0, hubY));
      g.add(rbox(0.22, 0.05, 0.24, 0.012, p('frame'), 0, seatY - 0.12, 0));
      g.add(rbox(w * 0.78, 0.085, d * 0.72, 0.035, p('body'), 0, seatY - 0.085, d * 0.06));
      const headH = Math.min(0.17, h * 0.14);
      const backBottom = seatY + 0.06;
      const backTop = h - headH - 0.04;
      const backH = Math.max(0.1, backTop - backBottom);
      const sag = 0.06;
      const back = curvedSlab(w * 0.72, backH, 0.03, sag, p('body'));
      back.position.set(0, backBottom + backH / 2, -d / 2 + 0.04 + sag / 2);
      g.add(back);
      g.add(rbox(0.06, backBottom - seatY + 0.12, 0.04, 0.01, p('frame'), 0, seatY - 0.1, -d / 2 + 0.03));
      const lumbar = curvedSlab(w * 0.5, Math.min(0.1, backH * 0.25), 0.03, sag * 0.6, p('body'));
      lumbar.position.set(0, backBottom + backH * 0.3, -d / 2 + 0.07 + sag / 2);
      g.add(lumbar);
      g.add(rbox(0.035, 0.05, 0.03, 0.008, p('frame'), 0, backTop - 0.01, -d / 2 + 0.03));
      const head = curvedSlab(w * 0.42, headH - 0.01, 0.045, sag * 0.6, p('body'));
      head.position.set(0, h - (headH - 0.01) / 2, -d / 2 + 0.035 + sag * 0.3);
      g.add(head);
      for (const sx of [-1, 1]) {
        const x = sx * (w / 2 - 0.035);
        g.add(rbox(0.03, 0.22, 0.04, 0.01, p('frame'), x, seatY - 0.04, -0.02));
        g.add(rbox(0.07, 0.03, d * 0.32, 0.012, p('body'), x, seatY + 0.18, 0.0));
      }
      break;
    }
    case 'desk-drawers': {
      // A top on a side panel at one end and a pedestal (a drawer over a cupboard) at the other.
      const top = 0.03;
      const under = h - top;
      const pw = Math.min(0.42, w * 0.36);
      const px = w / 2 - pw / 2;
      g.add(box(w, top, d, p('top'), 0, under, 0));
      g.add(box(0.03, under, d - 0.02, p('body'), -w / 2 + 0.015, 0, -0.01));
      g.add(box(pw, under, d - 0.02, p('body'), px, 0, -0.01));
      g.add(box(w - pw - 0.03, under * 0.45, 0.015, p('body'), (0.03 - pw) / 2, under * 0.55, -d / 2 + 0.0075));
      const front = d / 2 - 0.011;
      const drawerH = Math.min(0.16, under * 0.24);
      g.add(box(pw - 0.012, drawerH - 0.01, 0.018, p('fronts'), px, under - drawerH, front));
      g.add(box(pw - 0.012, under - drawerH - 0.03, 0.018, p('fronts'), px, 0.02, front));
      const handle = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.35, metalness: 0.6 });
      g.add(box(Math.min(0.12, pw * 0.4), 0.012, 0.008, handle, px, under - drawerH / 2 - 0.01, d / 2 - 0.006));
      g.add(box(0.012, Math.min(0.12, under * 0.2), 0.008, handle, px - pw / 2 + 0.05, under * 0.45, d / 2 - 0.006));
      break;
    }
    case 'monitor': {
      // A slim screen on a stand: an oval foot, a neck and the panel. Taller than wide is a
      // monitor turned upright.
      const panelT = 0.022;
      const panelH = Math.max(0.1, h - Math.min(0.13, h * 0.26));
      const baseH = 0.014;
      g.add(rbox(Math.min(w * 0.42, 0.26), baseH, Math.min(d, 0.2), 0.006, p('frame'), 0, 0, 0));
      g.add(rbox(0.045, h - panelH * 0.5 - baseH, 0.024, 0.008, p('frame'), 0, baseH, -panelT / 2 - 0.013));
      g.add(rbox(w, panelH, panelT, 0.006, p('frame'), 0, h - panelH, 0));
      const chin = Math.min(0.02, panelH * 0.06);
      g.add(box(w - 0.014, panelH - 0.014 - chin, 0.002, p('screen'), 0, h - panelH + 0.007 + chin, panelT / 2 + 0.001));
      emit(g, { shape: 'panel', size: w - 0.014, height: panelH - 0.014 - chin, facing: [0, 0, 1] }, 0, h - panelH / 2 + chin / 2, panelT / 2 + 0.003);
      break;
    }
    case 'laptop': {
      // Open, its lid tilted back a little on the hinge at the back, the screen facing the front.
      const baseT = Math.min(0.018, h * 0.09);
      const lidT = 0.007;
      const tilt = 0.24;
      const lidL = (h - baseT) / Math.cos(tilt);
      const behind = lidL * Math.sin(tilt) + lidT;
      const baseD = d - behind;
      const baseZ = d / 2 - baseD / 2;
      g.add(rbox(w, baseT, baseD, 0.005, p('body'), 0, 0, baseZ));
      g.add(box(w * 0.84, 0.0015, baseD * 0.42, p('keys'), 0, baseT, baseZ - baseD * 0.12));
      g.add(box(w * 0.34, 0.0008, baseD * 0.28, p('keys'), 0, baseT, baseZ + baseD * 0.28));
      const lid = new THREE.Group();
      lid.position.set(0, baseT, -d / 2 + behind);
      lid.rotation.x = -tilt;
      lid.add(rbox(w, lidL, lidT, 0.004, p('body'), 0, 0, -lidT / 2));
      lid.add(box(w - 0.02, lidL - 0.025, 0.0015, p('screen'), 0, 0.015, 0.001));
      g.add(lid);
      const screenMid = baseT + (lidL / 2) * Math.cos(tilt);
      emit(g, { shape: 'panel', size: w - 0.02, height: lidL - 0.025, facing: [0, Math.sin(tilt), Math.cos(tilt)] }, 0, screenMid, -d / 2 + behind - (lidL / 2) * Math.sin(tilt) + 0.004);
      break;
    }
    case 'wall-unit': {
      // A wall-mounted unit (an air conditioner): a rounded casing, its air outlet and a display.
      g.add(rbox(w, h, d - 0.004, Math.min(0.035, h * 0.15, d * 0.2), p('body'), 0, 0, -0.002));
      g.add(rbox(w * 0.86, Math.min(0.03, h * 0.12), 0.006, 0.002, p('vent'), 0, h * 0.1, d / 2 - 0.004));
      g.add(box(w * 0.9, 0.003, 0.004, p('vent'), 0, h * 0.62, d / 2 - 0.002));
      g.add(box(Math.min(0.05, w * 0.1), Math.min(0.015, h * 0.06), 0.004, p('vent'), w * 0.32, h * 0.4, d / 2 - 0.002));
      break;
    }
    case 'rail': {
      // A rod on two wall brackets, with hooks hanging under it.
      const r = Math.min(0.012, h / 4, d / 4);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w - 0.002, 12), p('body'));
      rod.rotation.z = Math.PI / 2;
      rod.position.set(0, h - r, d / 2 - r);
      g.add(rod);
      for (const sx of [-1, 1]) g.add(box(0.02, 2 * r + 0.01, d, p('body'), sx * (w / 2 - 0.01), h - 2 * r - 0.01, 0));
      const hooks = Math.max(1, Math.floor(w / 0.15) - 1);
      for (let i = 1; i <= hooks; i++) g.add(box(0.008, h - 2 * r, 0.008, p('body'), -w / 2 + (i * w) / (hooks + 1), 0, d / 2 - r));
      break;
    }
    case 'frame': {
      // A picture frame: four sides around the picture.
      const t = Math.min(0.02, w * 0.12, h * 0.12);
      g.add(box(w, t, d, p('frame')));
      g.add(box(w, t, d, p('frame'), 0, h - t, 0));
      g.add(box(t, h - 2 * t, d, p('frame'), -w / 2 + t / 2, t, 0));
      g.add(box(t, h - 2 * t, d, p('frame'), w / 2 - t / 2, t, 0));
      g.add(box(w - 2 * t, h - 2 * t, d * 0.5, p('picture'), 0, t, 0));
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
      // A base, a stem and an open shade with the bulb inside it.
      const shadeH = Math.min(0.3, h * 0.38);
      const baseH = Math.min(0.03, h * 0.08);
      g.add(cyl(w * 0.35, w * 0.4, baseH, p('body')));
      g.add(cyl(0.01, 0.01, h - shadeH * 0.5 - baseH, p('body'), 0, baseH));
      g.add(shade(w * 0.3, w * 0.5, shadeH, p('shade'), h - shadeH));
      emit(g, { shape: 'point', size: 0.03, facing: [0, -1, 0], shaded: true }, 0, h - shadeH * 0.55, 0);
      break;
    }
    case 'bulb': {
      // A round holder on the wall with the bulb sticking out of it.
      const r = Math.min(w, h) / 2;
      const holderD = Math.min(0.035, d * 0.25);
      const bulbR = Math.min(0.03, r * 0.6, (d - holderD) / 3);
      const y = h / 2;
      const holder = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.95, holderD, 28), p('holder'));
      holder.rotation.x = Math.PI / 2;
      holder.position.set(0, y, -d / 2 + holderD / 2);
      const socketL = Math.max(0.005, d - holderD - bulbR * 2.9);
      const socket = new THREE.Mesh(new THREE.CylinderGeometry(bulbR * 0.6, bulbR * 0.6, socketL, 20), p('holder'));
      socket.rotation.x = Math.PI / 2;
      socket.position.set(0, y, -d / 2 + holderD + socketL / 2);
      const neckL = bulbR * 1.2;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(bulbR * 0.85, bulbR * 0.5, neckL, 20), p('bulb'));
      neck.rotation.x = Math.PI / 2;
      neck.position.set(0, y, d / 2 - bulbR * 2 - neckL / 2 + bulbR * 0.15);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(bulbR, 24, 16), p('bulb'));
      glass.position.set(0, y, d / 2 - bulbR);
      g.add(holder, socket, neck, glass);
      emit(g, { shape: 'point', size: bulbR, facing: [0, 0, 1] }, 0, y, d / 2 - bulbR);
      break;
    }
    case 'tube-light': {
      // A batten on the wall holding a long tube.
      const r = Math.min(h, d) * 0.42;
      g.add(box(w, h * 0.7, d * 0.45, p('body'), 0, h * 0.15, -d / 2 + d * 0.225));
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w * 0.97, 16), p('tube'));
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0, h / 2, d / 2 - r);
      g.add(tube);
      for (const sx of [-1, 1]) g.add(box(0.02, h, d * 0.7, p('body'), sx * (w / 2 - 0.01), 0, -d / 2 + d * 0.35));
      emit(g, { shape: 'line', size: w * 0.95, facing: [0, 0, 1] }, 0, h / 2, d / 2 - r);
      break;
    }
    case 'ceiling-light': {
      // A flat round light on the ceiling: a rim and the diffuser that glows.
      const r = Math.min(w, d) / 2;
      g.add(cyl(r, r, h * 0.45, p('body'), 0, h * 0.55));
      g.add(cyl(r * 0.94, r * 0.9, h * 0.55, p('diffuser')));
      emit(g, { shape: 'disc', size: r * 0.9, facing: [0, -1, 0] }, 0, -0.001, 0);
      break;
    }
    case 'pendant': {
      // A cord from the ceiling, a shade, and the bulb under it.
      const bulbR = Math.min(0.03, w * 0.15);
      const shadeH = Math.min(0.22, h * 0.4);
      const shadeY = bulbR * 1.4;
      g.add(cyl(0.05, 0.05, 0.02, p('cord'), 0, h - 0.02));
      g.add(cyl(0.004, 0.004, h - 0.02 - shadeY - shadeH, p('cord'), 0, shadeY + shadeH));
      g.add(cyl(w * 0.12, w / 2, shadeH, p('shade'), 0, shadeY));
      const glass = new THREE.Mesh(new THREE.SphereGeometry(bulbR, 24, 16), p('bulb'));
      glass.position.y = bulbR;
      g.add(glass);
      emit(g, { shape: 'point', size: bulbR, facing: [0, -1, 0] }, 0, bulbR, 0);
      break;
    }
    case 'ceiling-fan': {
      // A canopy on the ceiling, the down rod, the motor and three blades.
      const motorH = Math.min(0.1, h * 0.3);
      const motorR = Math.min(0.11, w * 0.1);
      g.add(cyl(0.06, 0.07, 0.04, p('body'), 0, h - 0.04));
      g.add(cyl(0.012, 0.012, Math.max(0.01, h - 0.04 - motorH), p('body'), 0, motorH));
      g.add(cyl(motorR * 0.85, motorR, motorH * 0.55, p('body'), 0, motorH * 0.45));
      g.add(cyl(motorR, motorR * 0.8, motorH * 0.45, p('body')));
      // Each blade's rounded tip just touches the edge of the fan's circle.
      const reach = Math.min(w, d) / 2 - 0.006;
      const blade = new THREE.Shape();
      blade.moveTo(motorR * 0.8, -0.03);
      blade.lineTo(reach, -0.06);
      blade.quadraticCurveTo(reach + 0.012, 0, reach, 0.06);
      blade.lineTo(motorR * 0.8, 0.03);
      blade.closePath();
      const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: false, curveSegments: 6 });
      // The shape lies in x/y; lay it flat with its thickness upwards.
      bladeGeo.rotateX(Math.PI / 2);
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(bladeGeo, p('blades'));
        b.position.y = motorH * 0.55;
        // A slight pitch, as fan blades have.
        b.rotation.set(0, (i * 2 * Math.PI) / 3, 0.0);
        b.rotateX(0.12);
        g.add(b);
      }
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
