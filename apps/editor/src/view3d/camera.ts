// A three.js camera for a view of the home, placed by the core's cameraPose.
import { cameraPose, frameBox, type CameraRequest, type Home } from '@fullscale/core';
import * as THREE from 'three';

export function cameraFor(home: Home, request: CameraRequest, aspect: number): THREE.PerspectiveCamera {
  const pose = cameraPose(home, request, aspect);
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, pose.near, pose.far);
  camera.position.set(...pose.eye);
  camera.up.set(...pose.up);
  camera.lookAt(...pose.target);
  return camera;
}

/** The point a view frames, for orbiting around. */
export function frameCentre(home: Home, request: CameraRequest): THREE.Vector3 {
  const box = frameBox(home, request);
  return new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
}
