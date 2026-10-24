import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addItem, addOpening, addRectangularRoom, createHome, sampleFlat } from '@fullscale/core';
import { buildHomeScene, MaterialCache } from '../src/index.ts';

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
