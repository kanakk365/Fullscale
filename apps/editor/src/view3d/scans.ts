// Detailed models of phone captures, made on this computer by the room builder
// (`<capture>/built/room.glb`) and drawn where the capture's walls were imported, so the room
// can be seen as it really is: its photo colours and everything in it, small things too.
import { captureToHomeMatrix, type Home } from '@fullscale/core';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { authHeaders } from '../app/token.ts';

/** A capture's detailed model, or null when it has none (not built yet, or unreadable). */
const loaded = new Map<string, Promise<THREE.Object3D | null>>();

function load(capturePath: string): Promise<THREE.Object3D | null> {
  let promise = loaded.get(capturePath);
  if (!promise) {
    const url = `/files/home/${capturePath.split('/').map(encodeURIComponent).join('/')}/built/room.glb`;
    promise = new GLTFLoader()
      .setRequestHeader(authHeaders())
      .loadAsync(url)
      .then(
        (gltf) => gltf.scene,
        () => null,
      );
    loaded.set(capturePath, promise);
  }
  return promise;
}

export interface Scans {
  /** phone captures on the level */
  captures: number;
  /** their detailed models, placed in the home */
  models: THREE.Object3D[];
  loading: boolean;
}

/** The detailed models of the phone captures on a level. */
export function useScans(home: Home | null, level: string | null): Scans {
  const captures = useMemo(() => (home?.captures ?? []).filter((c) => c.kind === 'phone-capture' && c.toHome && c.toHome.level === level), [home, level]);
  const elevation = home?.levels.find((l) => l.id === level)?.elevation ?? 0;
  const [objects, setObjects] = useState<ReadonlyMap<string, THREE.Object3D | null>>(new Map());

  const paths = captures.map((c) => c.path).join('\n');
  useEffect(() => {
    let alive = true;
    for (const path of paths.split('\n').filter(Boolean)) {
      void load(path).then((object) => {
        if (alive) setObjects((m) => (m.has(path) ? m : new Map(m).set(path, object)));
      });
    }
    return () => {
      alive = false;
    };
  }, [paths]);

  const models = useMemo(
    () =>
      captures.flatMap((c) => {
        const object = objects.get(c.path);
        if (!object || !c.toHome) return [];
        const placed = new THREE.Group();
        placed.name = `scan ${c.id}`;
        placed.matrixAutoUpdate = false;
        placed.matrix.fromArray(captureToHomeMatrix(c.toHome, elevation));
        placed.add(object);
        return [placed];
      }),
    [captures, objects, elevation],
  );
  return { captures: captures.length, models, loading: captures.some((c) => !objects.has(c.path)) };
}
