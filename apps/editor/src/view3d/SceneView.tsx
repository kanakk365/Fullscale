// The 3D view: the home built by @fullscale/three (the same builder Blender's file comes
// from), lit softly, with the camera orbiting the level. Clicking selects.
import { buildHomeScene, disposeScene, MaterialCache, pickedElement, type BuildOptions } from '@fullscale/three';
import type { Home } from '@fullscale/core';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { select } from '../app/actions.ts';
import { shownHome, useEditor } from '../app/store.ts';
import { cameraFor, frameCentre } from './camera.ts';
import { useModels } from './models.ts';

/** The live view's lens; framing uses the same, so the home fills the view. */
const LIVE_FOV = 40;
/** The live view starts this much closer than the framing that fits everything with room
 *  to spare (which pictures for agents keep). */
const LIVE_CLOSER = 0.72;

export function SceneView() {
  const home = useEditor(shownHome);
  const level = useEditor((s) => s.level);
  if (!home || !level) return <div className="scene empty">Waiting for the home…</div>;
  return (
    <div className="scene">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: LIVE_FOV, near: 0.05, far: 1000 }} onPointerMissed={() => select([])} gl={{ antialias: true }}>
        <color attach="background" args={['#eef0f2']} />
        <hemisphereLight args={['#ffffff', '#b9b2a6', 1.4]} />
        <directionalLight
          position={[8, 14, 6]}
          intensity={1.6}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />
        <HomeModel home={home} level={level} />
        <CameraRig home={home} level={level} />
      </Canvas>
    </div>
  );
}

function HomeModel({ home, level }: { home: Home; level: string }) {
  const selection = useEditor((s) => s.selection);
  const cache = useMemo(() => new MaterialCache(), []);
  const models = useModels(home);
  const group = useMemo(() => {
    const opts: BuildOptions = { highlight: selection, levels: [level], models: (item) => (item.model ? models.get(item.model.file)?.clone() : undefined) };
    return buildHomeScene(home, cache, opts);
  }, [home, level, selection, models, cache]);
  useEffect(() => () => disposeScene(group), [group]);
  useEffect(() => () => cache.dispose(), [cache]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hit = pickedElement(e.object);
    if (hit) select([hit.id]);
  };
  // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object picked by a ray, not a DOM element
  return <primitive object={group} onClick={onClick} />;
}

/** Orbit controls, framed on the level when it is first shown. */
function CameraRig({ home, level }: { home: Home; level: string }) {
  const { camera, gl, size } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const framed = useRef<string | null>(null);

  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.maxPolarAngle = Math.PI * 0.49;
    controls.current = c;
    return () => c.dispose();
  }, [camera, gl]);

  useEffect(() => {
    if (framed.current === level || !controls.current || size.width < 10) return;
    framed.current = level;
    const view = { preset: 'three-quarter' as const, level, fov: LIVE_FOV };
    const placed = cameraFor(home, view, size.width / size.height);
    const target = frameCentre(home, view);
    camera.position.copy(target).lerp(placed.position, LIVE_CLOSER);
    controls.current.target.copy(target);
    controls.current.update();
  }, [home, level, camera, size]);

  useFrame(() => controls.current?.update());
  return null;
}
