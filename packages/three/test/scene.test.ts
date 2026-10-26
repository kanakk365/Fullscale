import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addItem, addOpening, addRectangularRoom, CATALOG, createHome, sampleFlat, updateWall, upsertMaterial, type Item } from '@fullscale/core';
import { buildFurniture, buildHomeScene, buildOpeningFill, MaterialCache } from '../src/index.ts';

const boxOf = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o);
};

describe('scene builder', () => {
  it('builds walls exactly where the document says', () => {
    let h = createHome({ name: 't', id: 't' });
    h = addRectangularRoom(h, { name: 'Room', x: 0, z: 0, width: 4, depth: 3 }).home;
    const scene = buildHomeScene(h, new MaterialCache());
    const north = scene.getObjectByName('wall-1')!;
    const b = boxOf(north);
    // Room-side face exactly at z = 0, thickness outside, full height.
    expect(b.max.z).toBeCloseTo(0, 5);
    expect(b.min.z).toBeCloseTo(-0.12, 5);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(b.max.y).toBeCloseTo(2.7, 5);
    // Wall 1 owns its start corner, so it reaches out to x = -0.12; its end corner
    // belongs to wall 2 (listed later walls only extend where earlier ones don't).
    expect(b.min.x).toBeCloseTo(-0.12, 5);
    expect(b.max.x).toBeCloseTo(4.12, 5);
  });

  it('cuts door notches and window holes', () => {
    let h = createHome({ name: 't', id: 't' });
    h = addRectangularRoom(h, { name: 'Room', x: 0, z: 0, width: 4, depth: 3 }).home;
    const plain = buildHomeScene(h, new MaterialCache()).getObjectByName('wall-1') as THREE.Mesh;
    h = addOpening(h, { wall: 'wall-1', type: 'door', offset: 0.5 }).home;
    h = addOpening(h, { wall: 'wall-1', type: 'window', offset: 2 }).home;
    const cut = buildHomeScene(h, new MaterialCache()).getObjectByName('wall-1') as THREE.Mesh;
    const tris = (m: THREE.Mesh) => m.geometry.getAttribute('position').count / 3;
    expect(tris(cut)).toBeGreaterThan(tris(plain));
    // Three material groups: left face, sides, right face.
    expect(new Set(cut.geometry.groups.map((g) => g.materialIndex))).toEqual(new Set([0, 1, 2]));
  });

  it('builds furniture at its exact size and rotation', () => {
    let h = createHome({ name: 't', id: 't' });
    h = addItem(h, { catalog: 'sofa-3', position: [1, 2], rotation: 90 }).home;
    const sofa = buildHomeScene(h, new MaterialCache()).getObjectByName('sofa-3-1')!;
    const s = boxOf(sofa).getSize(new THREE.Vector3());
    // Rotated 90°: width runs along z, depth along x.
    expect(s.x).toBeCloseTo(0.92, 3);
    expect(s.y).toBeCloseTo(0.85, 3);
    expect(s.z).toBeCloseTo(2.1, 3);
  });

  it('cuts a niche part-way into the wall, open on its own face, with shelves inside', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = updateWall(h, { id: 'wall-1', thickness: 0.25 }).home;
    h = addOpening(h, { id: 'n1', wall: 'wall-1', type: 'niche', width: 0.8, height: 1.2, sill: 0.6, depth: 0.2, shelves: 2 }).home;
    const wall = h.walls.find((w) => w.id === 'wall-1')!;
    const niche = h.openings[0]!;
    const fill = buildOpeningFill(wall, niche, { frame: new THREE.MeshBasicMaterial(), glass: new THREE.MeshBasicMaterial(), door: new THREE.MeshBasicMaterial() });
    const boxes = fill.children as THREE.Mesh[];
    expect(boxes).toHaveLength(3);
    // In the fill's frame, +z is the wall's right side and the wall spans z ±0.125.
    const toward = niche.face === 'right' ? 1 : -1;
    const back = boxes[0]!;
    const backDepth = (back.geometry as THREE.BoxGeometry).parameters.depth;
    expect(backDepth).toBeCloseTo(0.05, 9);
    expect(back.position.z * toward).toBeCloseTo(-0.1, 9);
    for (const shelf of boxes.slice(1)) {
      expect(shelf.position.z * toward).toBeCloseTo(0.025, 9);
      expect((shelf.geometry as THREE.BoxGeometry).parameters.depth).toBeCloseTo(0.2, 9);
    }
  });

  it('shuts a door whose leaf is set to 0°', () => {
    const h = addOpening(addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home, { id: 'd1', wall: 'wall-1', type: 'door', openDegrees: 0 }).home;
    const fill = buildOpeningFill(h.walls[0]!, h.openings[0]!, { frame: new THREE.MeshBasicMaterial(), glass: new THREE.MeshBasicMaterial(), door: new THREE.MeshBasicMaterial() });
    const hinge = fill.children.find((c) => c.name === 'd1:hinge')!;
    expect(hinge.rotation.y).toBeCloseTo(0, 12);
  });

  it('keeps every catalogue item inside its size, filling its width and height', () => {
    for (const entry of CATALOG) {
      const item = { id: 'i', level: 'level-0', catalog: entry.id, name: entry.name, position: [0, 0, 0], rotation: 0, size: entry.size, materials: {} } as unknown as Item;
      const b = new THREE.Box3().setFromObject(buildFurniture(item, () => new THREE.MeshBasicMaterial()));
      const [w, h, d] = entry.size;
      const where = `${entry.id}: ${b.min.toArray().map((v) => v.toFixed(4))} to ${b.max.toArray().map((v) => v.toFixed(4))}`;
      expect(b.min.x, where).toBeGreaterThanOrEqual(-w / 2 - 1e-6);
      expect(b.max.x, where).toBeLessThanOrEqual(w / 2 + 1e-6);
      expect(b.min.y, where).toBeGreaterThanOrEqual(-1e-6);
      expect(b.max.y, where).toBeLessThanOrEqual(h + 1e-6);
      expect(b.min.z, where).toBeGreaterThanOrEqual(-d / 2 - 1e-6);
      expect(b.max.z, where).toBeLessThanOrEqual(d / 2 + 1e-6);
      // A fan's size is the circle its blades sweep; three blades don't fill the square.
      if (entry.shape === 'ceiling-fan') expect(b.max.x, where).toBeCloseTo(w / 2, 3);
      else expect(b.max.x - b.min.x, where).toBeCloseTo(w, 3);
      expect(b.max.y, where).toBeCloseTo(h, 3);
    }
  });

  it('makes a lit lamp’s glowing part glow and marks where its light comes from', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = addItem(h, { catalog: 'wall-bulb', position: [2, 2.4, 0.1] }).home;
    h = addItem(h, { catalog: 'floor-lamp', position: [1, 1], light: { on: false } }).home;
    const scene = buildHomeScene(h, new MaterialCache());
    const bulb = scene.getObjectByName('wall-bulb-1')!;
    const point = bulb.getObjectByName('light')!;
    expect(point.userData.light).toMatchObject({ shape: 'point', on: true, kelvin: 6500, lumens: 900, facing: [0, 0, 1] });
    const glowing = new Set<string>();
    bulb.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m?.userData?.fullscale?.glow) glowing.add(m.uuid);
    });
    expect(glowing.size).toBe(1);
    // A lamp that's off has its light point (marked off) but nothing glows.
    const lamp = scene.getObjectByName('floor-lamp-1')!;
    expect(lamp.getObjectByName('light')!.userData.light).toMatchObject({ on: false, shaded: true });
    lamp.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      expect(m?.userData?.fullscale?.glow).toBeUndefined();
    });
  });

  it('draws a pair of panelled door leaves, each on its own hinge, and a window’s grid of panes', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = addOpening(h, { id: 'd1', wall: 'wall-1', type: 'door', width: 1.2, leaves: 2, panels: 3, openDegrees: 0 }).home;
    h = addOpening(h, { id: 'w1', wall: 'wall-3', type: 'window', width: 0.8, leaves: 2, panes: [1, 4] }).home;
    const mats = { frame: new THREE.MeshBasicMaterial(), glass: new THREE.MeshBasicMaterial(), door: new THREE.MeshBasicMaterial() };
    const door = buildOpeningFill(h.walls[0]!, h.openings[0]!, mats);
    const hinges = door.children.filter((c) => c.name.startsWith('d1:hinge'));
    expect(hinges).toHaveLength(2);
    // Each leaf: the slab, three raised panels and a handle.
    for (const hinge of hinges) expect(hinge.children[0]!.children).toHaveLength(5);
    const window = buildOpeningFill(h.walls[2]!, h.openings[1]!, mats);
    const glass = window.children.filter((c) => (c as THREE.Mesh).material === mats.glass);
    expect(glass).toHaveLength(2);
    // Per leaf: a sash of four sides and three bars between four panes.
    const bars = window.children.filter((c) => (c as THREE.Mesh).material === mats.frame).length - 4;
    expect(bars).toBe(2 * (4 + 3));
  });

  it('lays repeating pictures out in metres', () => {
    let h = addRectangularRoom(createHome({ name: 't' }), { name: 'R', x: 0, z: 0, width: 4, depth: 3 }).home;
    h = upsertMaterial(h, {
      material: {
        id: 'print',
        name: 'Print',
        kind: 'fabric',
        color: '#aa3344',
        image: { file: 'textures/print.jpg', width: 0.5, height: 0.5, fit: 'repeat' },
        roughness: 0.9,
        metalness: 0,
        opacity: 1,
      },
    }).home;
    h = addItem(h, { catalog: 'rug', position: [2, 1.5], size: [2, 0.01, 1.4], materials: { body: 'print' } }).home;
    const scene = buildHomeScene(h, new MaterialCache());
    const rug = scene.getObjectByName('rug-1')!.children[0] as THREE.Mesh;
    const uv = rug.geometry.getAttribute('uv');
    let most = 0;
    for (let i = 0; i < uv.count; i++) most = Math.max(most, Math.abs(uv.getX(i)));
    // Half the rug's 2 m width either side of its middle.
    expect(most).toBeCloseTo(1, 6);
  });

  it('builds the whole sample flat', () => {
    const scene = buildHomeScene(sampleFlat(), new MaterialCache(), { ceilings: true });
    scene.updateMatrixWorld(true);
    const b = new THREE.Box3();
    scene.traverse((o) => {
      if (o.userData.kind === 'wall') b.union(new THREE.Box3().setFromObject(o));
    });
    expect(b.min.x).toBeCloseTo(-0.12, 3);
    expect(b.max.x).toBeCloseTo(8.24, 3);
    expect(b.max.z).toBeCloseTo(7.44, 3);
  });
});
