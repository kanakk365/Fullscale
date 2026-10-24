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
export function buildOpeningFill(wall: Wall, o: Opening, mats: { frame: THREE.Material; glass: THREE.Material; door: THREE.Material }): THREE.Group {
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
  if (o.type === 'window') {
    addBox(o.width, frameT, depth, 0, o.height / 2 - frameT / 2, 0, mats.frame);
    addBox(o.width, frameT, depth, 0, -o.height / 2 + frameT / 2, 0, mats.frame);
    addBox(frameT, o.height, depth, -o.width / 2 + frameT / 2, 0, 0, mats.frame);
    addBox(frameT, o.height, depth, o.width / 2 - frameT / 2, 0, 0, mats.frame);
    if (o.width > 1.0) addBox(frameT * 0.8, o.height - 2 * frameT, depth * 0.6, 0, 0, 0, mats.frame);
    addBox(o.width - 2 * frameT, o.height - 2 * frameT, 0.01, 0, 0, 0, mats.glass);
  } else if (o.type === 'door') {
    addBox(o.width, frameT, depth, 0, o.height / 2 - frameT / 2, 0, mats.frame);
    addBox(frameT, o.height, depth, -o.width / 2 + frameT / 2, 0, 0, mats.frame);
    addBox(frameT, o.height, depth, o.width / 2 - frameT / 2, 0, 0, mats.frame);
    // Door leaf, slightly open, hinged on the chosen jamb and swinging to the chosen side.
    const leafW = o.width - 2 * frameT;
    const leafH = o.height - frameT;
    const hingeSign = o.hinge === 'end' ? 1 : -1;
    const pivot = new THREE.Group();
    pivot.position.set(hingeSign * (leafW / 2), -frameT / 2, 0);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, leafH, 0.04), mats.door);
    leaf.position.set(-hingeSign * (leafW / 2), 0, 0);
    pivot.add(leaf);
    // Local +z is the wall's right side.
    const swingSign = o.swing === 'right' ? 1 : -1;
    pivot.rotation.y = hingeSign * swingSign * -0.35;
    g.add(pivot);
  }
  return g;
}
