// The user's own 3D models (glTF/GLB files, e.g. downloaded from a shop's website),
// fitted to an item's true size. Shop models often use odd units or origins, so we
// never trust their scale: we measure the model and scale it to the size the person
// entered (ideally the maker's listed dimensions).
import * as THREE from 'three';
import { shapeMismatch, type ModelRef } from '@fullscale/core';

export type Size3 = [number, number, number];

export interface FittedModel {
  /** bottom-centre at the origin, front facing +z, at the fitted size */
  object: THREE.Group;
  /** the model's own bounding box in its file units, after turning by `yaw` */
  nativeSize: Size3;
  scale: Size3;
  /** outer size after fitting: equals `size` for stretch; fits inside it for uniform */
  fittedSize: Size3;
  /** 0 = the model has the same proportions as `size`; 0.05 = 5% off */
  shapeMismatch: number;
}

/**
 * Wrap `model` (pass a copy if you reuse it) so it stands at the origin, bottom-centred,
 * front facing +z, at `size` metres [width, height, depth]. The returned `nativeSize`
 * is what an importer stores in the item's ModelRef.
 */
export function fitModel(model: THREE.Object3D, size: Size3, opts: Partial<Pick<ModelRef, 'fit' | 'yaw'>> = {}): FittedModel {
  const turn = new THREE.Group();
  turn.name = 'user-model';
  // Copies of a loaded model share its geometry; disposeScene leaves this subtree alone.
  turn.userData.sharedGeometry = true;
  turn.rotation.y = THREE.MathUtils.degToRad(opts.yaw ?? 0);
  turn.add(model);
  turn.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(turn, true);
  if (box.isEmpty()) throw new Error('The model has no geometry');
  const centre = box.getCenter(new THREE.Vector3());
  turn.position.set(-centre.x, -box.min.y, -centre.z);

  const s = box.getSize(new THREE.Vector3());
  const nativeSize: Size3 = [s.x, s.y, s.z];
  // A flat model (e.g. a rug scanned as a plane) has no height to scale; give that axis
  // the smallest scale of the others.
  const ratios = nativeSize.map((n, i) => (n > 1e-6 ? size[i]! / n : NaN));
  const finite = ratios.filter((r) => Number.isFinite(r));
  if (finite.length === 0) throw new Error('The model has no size');
  const uniform = Math.min(...finite);
  const scale = (opts.fit === 'stretch' ? ratios.map((r) => (Number.isFinite(r) ? r : uniform)) : [uniform, uniform, uniform]) as Size3;

  const object = new THREE.Group();
  object.add(turn);
  object.scale.set(...scale);
  return {
    object,
    nativeSize,
    scale,
    fittedSize: [nativeSize[0] * scale[0], nativeSize[1] * scale[1], nativeSize[2] * scale[2]],
    shapeMismatch: finite.length === 3 ? shapeMismatch(nativeSize, size) : 0,
  };
}
