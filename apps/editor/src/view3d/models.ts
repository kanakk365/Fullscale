// The user's own 3D models, loaded from the studio (which serves them to this computer only)
// and drawn at their item's true size. A model that is missing or fails to load leaves the
// catalogue shape in its place.
import type { Home } from '@fullscale/core';
import { useEffect, useState } from 'react';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { authHeaders } from '../app/token.ts';

const loaded = new Map<string, Promise<THREE.Object3D | null>>();

function load(file: string): Promise<THREE.Object3D | null> {
  let promise = loaded.get(file);
  if (!promise) {
    const loader = new GLTFLoader().setRequestHeader(authHeaders());
    const url = `/files/models/${file.split('/').map(encodeURIComponent).join('/')}`;
    promise = loader.loadAsync(url).then(
      (gltf) => gltf.scene,
      () => null,
    );
    loaded.set(file, promise);
  }
  return promise;
}

/** Loaded models by file, for the files a home uses. Updates as models arrive. */
export function useModels(home: Home | null): ReadonlyMap<string, THREE.Object3D> {
  const [models, setModels] = useState<ReadonlyMap<string, THREE.Object3D>>(new Map());
  const files = [...new Set((home?.items ?? []).flatMap((i) => (i.model ? [i.model.file] : [])))].sort().join('\n');
  useEffect(() => {
    let alive = true;
    for (const file of files.split('\n').filter(Boolean)) {
      void load(file).then((object) => {
        if (alive && object) setModels((m) => (m.has(file) ? m : new Map(m).set(file, object)));
      });
    }
    return () => {
      alive = false;
    };
  }, [files]);
  return models;
}
