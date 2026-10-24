import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addItem, createHome } from '@fullscale/core';
import { buildHomeScene, disposeScene, fitModel, MaterialCache } from '../src/index.ts';

const sizeOf = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(o, true);
};

/** A stand-in for a shop model: centimetre units, origin off in a corner. */
function shopModel(w: number, h: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial());
  mesh.position.set(500, 37, -120);
  g.add(mesh);
  return g;
}

describe('fitting user models', () => {
  it('scales a centimetre model to the true size, bottom-centred', () => {
    const fit = fitModel(shopModel(218, 83, 99), [2.18, 0.83, 0.99]);
    expect(fit.nativeSize.map((n) => +n.toFixed(6))).toEqual([218, 83, 99]);
    expect(fit.shapeMismatch).toBeCloseTo(0, 9);
    const b = sizeOf(fit.object);
    expect(b.min.x).toBeCloseTo(-1.09, 6);
    expect(b.max.x).toBeCloseTo(1.09, 6);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.83, 6);
    expect(b.min.z).toBeCloseTo(-0.495, 6);
    expect(b.max.z).toBeCloseTo(0.495, 6);
  });

  it('turns a model whose front faces sideways', () => {
    // Front along +x in the file: 0.99 wide in x, 2.18 long in z.
    const fit = fitModel(shopModel(99, 83, 218), [2.18, 0.83, 0.99], { yaw: 90 });
    const s = sizeOf(fit.object).getSize(new THREE.Vector3());
    expect(s.x).toBeCloseTo(2.18, 6);
    expect(s.z).toBeCloseTo(0.99, 6);
  });

  it('keeps proportions by default and stretches only when asked', () => {
    const uniform = fitModel(shopModel(2, 1, 1), [2, 0.85, 0.9]);
    // Fits inside the box, so clearance checks on the item size stay safe.
    expect(uniform.fittedSize.map((n) => +n.toFixed(6))).toEqual([1.7, 0.85, 0.85]);
    expect(uniform.shapeMismatch).toBeCloseTo(1 / 0.85 - 1, 6);
    const stretch = fitModel(shopModel(2, 1, 1), [2, 0.85, 0.9], { fit: 'stretch' });
    const s = sizeOf(stretch.object).getSize(new THREE.Vector3());
    expect([s.x, s.y, s.z].map((n) => +n.toFixed(6))).toEqual([2, 0.85, 0.9]);
  });

  it('draws the model in the scene at the item size, else the catalogue shape', () => {
    let h = createHome({ name: 't', id: 't' });
    h = addItem(h, { catalog: 'sofa-3', position: [3, 2], rotation: 90, size: [2.18, 0.83, 0.99], model: { file: 'ikea/sofa.glb' } }).home;
    const original = shopModel(218, 83, 99);
    const scene = buildHomeScene(h, new MaterialCache(), { models: () => original.clone() });
    const sofa = scene.getObjectByName('sofa-3-1')!;
    expect(sofa.getObjectByName('user-model')).toBeDefined();
    const b = sizeOf(sofa);
    // Rotated 90°: width along z.
    expect(b.max.x - b.min.x).toBeCloseTo(0.99, 6);
    expect(b.max.z - b.min.z).toBeCloseTo(2.18, 6);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(2, 6);

    // Disposing the scene must not free the loaded model's shared geometry.
    let disposed = false;
    (original.children[0] as THREE.Mesh).geometry.addEventListener('dispose', () => (disposed = true));
    disposeScene(scene);
    expect(disposed).toBe(false);

    // File not on this computer: fall back to the catalogue sofa.
    const fallback = buildHomeScene(h, new MaterialCache(), { models: () => undefined }).getObjectByName('sofa-3-1')!;
    expect(fallback.getObjectByName('user-model')).toBeUndefined();
  });
});
