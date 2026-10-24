// 3D pictures for agents, drawn here in the person's browser (the studio has no GPU of its
// own) and sent back through the studio. They show catalogue shapes, never the person's own
// models: those stay on this computer.
import { buildHomeScene, disposeScene, MaterialCache } from '@fullscale/three';
import type { Home } from '@fullscale/core';
import type { View } from '@fullscale/protocol';
import * as THREE from 'three';
import { cameraFor } from './camera.ts';

/** Draw the home from a view; returns the PNG as base64. */
export function renderSnapshot(home: Home, view: View, size: { width: number; height: number }): string {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  const cache = new MaterialCache();
  const scene = new THREE.Scene();
  const level = view.level ?? home.levels[0]!.id;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size.width, size.height, false);
    scene.background = new THREE.Color('#eef0f2');
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9b2a6', 1.4));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const model = buildHomeScene(home, cache, { levels: [level], ceilings: view.ceilings ?? false, ...(view.focus ? { highlight: view.focus } : {}) });
    scene.add(model);
    renderer.render(scene, cameraFor(home, view, size.width / size.height));
    disposeScene(model);
    return renderer.domElement.toDataURL('image/png').split(',')[1]!;
  } finally {
    cache.dispose();
    renderer.dispose();
    // Browsers allow only a few live WebGL contexts; give this one back at once.
    renderer.forceContextLoss();
  }
}
