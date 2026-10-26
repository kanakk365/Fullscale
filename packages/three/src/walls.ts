// Wall meshes with real holes for windows and notches for doors.
//
// Each wall is a 2D outline in its own (u along the wall, v up) frame, extruded through
// its thickness. Extrusion starts at the wall's left face and ends at its right face, so
// the two big faces can take different materials. The ends are then sheared so each face
// stops where the corner solver says, which gives exact mitres without any 3D boolean cuts.
import * as THREE from 'three';
import { faceOffsets, faceStops, leftOf, levelJoins, wallDirection, wallHeight, wallLength, type Home, type LevelJoins, type Opening, type Wall } from '@fullscale/core';

function wallShape(len: number, height: number, openings: Opening[]): THREE.Shape {
  const u0 = 0;
  const u1 = len;
  const doors = openings.filter((o) => o.sill <= 0.001).sort((a, b) => a.offset - b.offset);
  const holes = openings.filter((o) => o.sill > 0.001);

  const shape = new THREE.Shape();
  shape.moveTo(u0, 0);
  for (const d of doors) {
    const a = Math.max(u0 + 0.001, d.offset);
    const b = Math.min(u1 - 0.001, d.offset + d.width);
    const top = Math.min(d.height, height - 0.001);
    shape.lineTo(a, 0);
    shape.lineTo(a, top);
    shape.lineTo(b, top);
    shape.lineTo(b, 0);
  }
  shape.lineTo(u1, 0);
  shape.lineTo(u1, height);
  shape.lineTo(u0, height);
  shape.lineTo(u0, 0);

  for (const w of holes) {
    const a = Math.max(u0 + 0.001, w.offset);
    const b = Math.min(u1 - 0.001, w.offset + w.width);
    const bottom = w.sill;
    const top = Math.min(w.sill + w.height, height - 0.001);
    if (b <= a || top <= bottom) continue;
    const hole = new THREE.Path();
    hole.moveTo(a, bottom);
    hole.lineTo(a, top);
    hole.lineTo(b, top);
    hole.lineTo(b, bottom);
    hole.lineTo(a, bottom);
    shape.holes.push(hole);
  }
  return shape;
}

/** Split ExtrudeGeometry's cap group into left face (z = 0) and right face (z = depth)
 *  groups: material 0 = left face, 1 = sides (top, ends, jambs), 2 = right face. */
function splitCaps(geo: THREE.BufferGeometry, depth: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const caps = geo.groups.find((g) => g.materialIndex === 0);
  const sides = geo.groups.find((g) => g.materialIndex === 1);
  if (!caps || !sides || geo.index) return;
  // Reorder cap triangles: left first, then right.
  const left: number[] = [];
  const right: number[] = [];
  for (let t = caps.start; t < caps.start + caps.count; t += 3) {
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    (z < depth / 2 ? left : right).push(t);
  }
  const attrs = Object.keys(geo.attributes);
  const copies = attrs.map((name) => {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    return { a, src: (a.array as Float32Array).slice() };
  });
  let write = caps.start;
  for (const t of [...left, ...right]) {
    for (const { a, src } of copies) {
      const s = a.itemSize;
      for (let k = 0; k < 3; k++) {
        for (let c = 0; c < s; c++) (a.array as Float32Array)[(write + k) * s + c] = src[(t + k) * s + c]!;
      }
    }
    write += 3;
  }
  geo.clearGroups();
  geo.addGroup(caps.start, left.length * 3, 0);
  geo.addGroup(caps.start + left.length * 3, right.length * 3, 2);
  geo.addGroup(sides.start, sides.count, 1);
  for (const { a } of copies) a.needsUpdate = true;
}

/** Move the vertices at each end of the extruded outline along the wall so the left face
 *  (depth 0) and right face (depth = thickness) stop at their own corner points. */
function shearEnds(geo: THREE.BufferGeometry, len: number, thickness: number, stops: ReturnType<typeof faceStops>): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const EDGE = 1e-9;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i);
    const t = pos.getZ(i) / thickness;
    if (Math.abs(u) < EDGE) pos.setX(i, stops.start.left + (stops.start.right - stops.start.left) * t);
    else if (Math.abs(u - len) < EDGE) pos.setX(i, stops.end.left + (stops.end.right - stops.end.left) * t);
  }
  pos.needsUpdate = true;
}

/** Texture coordinates in metres: along the wall and up on the faces, along and across on
 *  the top, across and up on the ends and jambs. Tiles keep their real size at any angle. */
function metreUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const [nx, ny] = [Math.abs(normal.getX(i)), Math.abs(normal.getY(i))];
    if (ny > 0.5) uv.setXY(i, x, z);
    else if (nx > 0.5) uv.setXY(i, z, y);
    else uv.setXY(i, x, y);
  }
  uv.needsUpdate = true;
}

/** Build a wall's mesh geometry. Pass the level's joins when building many walls, so the
 *  corner solver runs once per level instead of once per wall. */
export function buildWallGeometry(home: Home, wall: Wall, joins: LevelJoins = levelJoins(home, wall.level)): { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 } {
  const len = wallLength(wall);
  const openings = home.openings.filter((o) => o.wall === wall.id);
  const shape = wallShape(len, wallHeight(home, wall), openings);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: wall.thickness, bevelEnabled: false, steps: 1 });
  splitCaps(geometry, wall.thickness);
  const join = joins.walls.get(wall.id);
  if (join) shearEnds(geometry, len, wall.thickness, faceStops(wall, join));
  geometry.computeVertexNormals();
  metreUVs(geometry);

  // Local frame: X along the wall, Y up, Z towards the wall's right side.
  const d = wallDirection(wall);
  const n = leftOf(d);
  const off = faceOffsets(wall);
  const X = new THREE.Vector3(d[0], 0, d[1]);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3().crossVectors(X, Y);
  const origin = new THREE.Vector3(wall.start[0] + n[0] * off.left, 0, wall.start[1] + n[1] * off.left);
  const matrix = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(origin);
  return { geometry, matrix };
}

/** Door leaves, window glass and frames for one opening, in world space. */
/** A door leaf centred on its own origin: flush, or with raised panels stacked up both
 *  faces, and a handle on both faces near its free edge (`handleSide` is -1 or 1 along x). */
function doorLeaf(w: number, h: number, t: number, panels: number, wood: THREE.Material, metal: THREE.Material, handleSide: number): THREE.Group {
  const leaf = new THREE.Group();
  const add = (bw: number, bh: number, bd: number, x: number, y: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), m);
    mesh.position.set(x, y, 0);
    leaf.add(mesh);
  };
  add(w, h, t, 0, 0, wood);
  if (panels > 0) {
    // Stiles at the sides, rails between: a deeper bottom rail, as panelled doors have.
    const stile = Math.min(0.1, w * 0.18);
    const top = 0.1;
    const bottom = Math.min(0.22, h * 0.12);
    const rail = 0.09;
    const panelH = (h - top - bottom - rail * (panels - 1)) / panels;
    for (let i = 0; i < panels; i++) {
      const y = -h / 2 + bottom + panelH / 2 + i * (panelH + rail);
      add(w - 2 * stile, panelH, t + 0.012, 0, y, wood);
    }
  }
  const x = handleSide * (w / 2 - Math.min(0.07, w * 0.12));
  add(0.025, 0.14, t + 0.05, x, 1.0 - h / 2 - 0.05, metal);
  return leaf;
}

export function buildOpeningFill(wall: Wall, o: Opening, mats: { frame: THREE.Material; glass: THREE.Material; door: THREE.Material; inside?: THREE.Material; metal?: THREE.Material }): THREE.Group {
  const g = new THREE.Group();
  const d = wallDirection(wall);
  const n = leftOf(d);
  const off = faceOffsets(wall);
  const mid = (off.left + off.right) / 2;
  const centerU = o.offset + o.width / 2;
  const cx = wall.start[0] + d[0] * centerU + n[0] * mid;
  const cz = wall.start[1] + d[1] * centerU + n[1] * mid;
  g.position.set(cx, o.sill + o.height / 2, cz);
  g.rotation.y = Math.atan2(-d[1], d[0]);

  const frameT = 0.05;
  const depth = wall.thickness + 0.01;
  const addBox = (w: number, h: number, dep: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  if (o.type === 'niche') {
    // The wall's outline has a hole here; fill it from the far face back to the recess's
    // depth, so the recess opens only on its own face. Local +z is the wall's right side.
    const t = wall.thickness;
    const deep = Math.min(o.depth ?? 0.15, t - 0.005);
    const toward = o.face === 'right' ? 1 : -1;
    const inside = mats.inside ?? mats.frame;
    const backT = t - deep;
    addBox(o.width, o.height, backT, 0, 0, -toward * (deep / 2), inside);
    const shelves = o.shelves ?? 0;
    const board = 0.025;
    for (let i = 1; i <= shelves; i++) {
      const y = -o.height / 2 + (i * o.height) / (shelves + 1);
      addBox(o.width, board, deep, 0, y, toward * (t / 2 - deep / 2), inside);
    }
  } else if (o.type === 'window') {
    // A slim frame in the middle of the wall, so the wall's reveals show around it, holding
    // one or two leaves, each with its grid of panes.
    const frameD = Math.min(0.08, depth);
    addBox(o.width, frameT, frameD, 0, o.height / 2 - frameT / 2, 0, mats.frame);
    addBox(o.width, frameT, frameD, 0, -o.height / 2 + frameT / 2, 0, mats.frame);
    addBox(frameT, o.height - 2 * frameT, frameD, -o.width / 2 + frameT / 2, 0, 0, mats.frame);
    addBox(frameT, o.height - 2 * frameT, frameD, o.width / 2 - frameT / 2, 0, 0, mats.frame);
    const leaves = o.leaves ?? (o.width > 1.0 ? 2 : 1);
    const [across, up] = o.panes ?? [1, 1];
    const innerW = o.width - 2 * frameT;
    const innerH = o.height - 2 * frameT;
    const leafW = innerW / leaves;
    const sash = Math.min(0.04, leafW * 0.12, innerH * 0.12);
    const bar = Math.min(0.022, sash);
    const sashD = Math.min(0.045, frameD);
    for (let l = 0; l < leaves; l++) {
      const x = -innerW / 2 + leafW * (l + 0.5);
      addBox(leafW, sash, sashD, x, innerH / 2 - sash / 2, 0, mats.frame);
      addBox(leafW, sash, sashD, x, -innerH / 2 + sash / 2, 0, mats.frame);
      addBox(sash, innerH - 2 * sash, sashD, x - leafW / 2 + sash / 2, 0, 0, mats.frame);
      addBox(sash, innerH - 2 * sash, sashD, x + leafW / 2 - sash / 2, 0, 0, mats.frame);
      const gw = leafW - 2 * sash;
      const gh = innerH - 2 * sash;
      for (let i = 1; i < across; i++) addBox(bar, gh, sashD * 0.8, x - gw / 2 + (i * gw) / across, 0, 0, mats.frame);
      for (let j = 1; j < up; j++) addBox(gw, bar, sashD * 0.8, x, -gh / 2 + (j * gh) / up, 0, mats.frame);
      addBox(gw, gh, 0.006, x, 0, 0, mats.glass);
    }
  } else if (o.type === 'door') {
    addBox(o.width, frameT, depth, 0, o.height / 2 - frameT / 2, 0, mats.frame);
    addBox(frameT, o.height, depth, -o.width / 2 + frameT / 2, 0, 0, mats.frame);
    addBox(frameT, o.height, depth, o.width / 2 - frameT / 2, 0, 0, mats.frame);
    // One leaf, or a pair meeting in the middle, each hinged on its jamb and swinging to the
    // chosen side.
    const leaves = o.leaves ?? 1;
    const leafW = (o.width - 2 * frameT) / leaves;
    const leafH = o.height - frameT;
    const leafT = 0.04;
    // Local +z is the wall's right side. Unset, the leaf stands ajar so it reads as a door.
    const swingSign = o.swing === 'right' ? 1 : -1;
    const open = o.openDegrees !== undefined ? (o.openDegrees * Math.PI) / 180 : 0.35;
    const hinges: Array<1 | -1> = leaves === 2 ? [-1, 1] : [o.hinge === 'end' ? 1 : -1];
    hinges.forEach((hingeSign, i) => {
      const pivot = new THREE.Group();
      // Named and marked so other programs (Blender, viewers) can find the hinge and swing it.
      pivot.name = i === 0 ? `${o.id}:hinge` : `${o.id}:hinge-${i + 1}`;
      pivot.position.set(hingeSign * (leafW * (leaves === 2 ? 1 : 0.5)), -frameT / 2, 0);
      // The handle is on the free edge: away from the hinge, which for a pair is where they meet.
      const leaf = doorLeaf(leafW, leafH, leafT, o.panels ?? 0, mats.door, mats.metal ?? mats.frame, -hingeSign);
      leaf.position.set(-hingeSign * (leafW / 2), 0, 0);
      pivot.add(leaf);
      pivot.rotation.y = hingeSign * swingSign * -open;
      pivot.userData = { hinge: { axis: 'y', openRadians: pivot.rotation.y } };
      g.add(pivot);
    });
  }
  return g;
}
