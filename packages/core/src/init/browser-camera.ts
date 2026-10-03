/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from '../runtime/index.js';

/**
 * @internal
 * Snapshot of the local-space camera state captured before an XR session
 * starts, used to undo the head-pose / projection mutations that
 * `WebGLRenderer.xr` writes into the camera each frame.
 */
export interface BrowserCameraSnapshot {
  position: Vector3;
  quaternion: Quaternion;
  scale: Vector3;
  aspect: number;
  fov: number;
  near: number;
  far: number;
  zoom: number;
}

/**
 * @internal
 * Capture the local transform and projection of `camera`.
 */
export function snapshotBrowserCamera(
  camera: PerspectiveCamera,
): BrowserCameraSnapshot {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    scale: camera.scale.clone(),
    aspect: camera.aspect,
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
  };
}

/**
 * @internal
 * Apply a snapshot back to `camera`, refreshing both projection and world
 * matrices. Safe to call regardless of XR state.
 */
export function applyBrowserCameraSnapshot(
  camera: PerspectiveCamera,
  snapshot: BrowserCameraSnapshot,
): void {
  camera.position.copy(snapshot.position);
  camera.quaternion.copy(snapshot.quaternion);
  camera.scale.copy(snapshot.scale);
  camera.aspect = snapshot.aspect;
  camera.fov = snapshot.fov;
  camera.near = snapshot.near;
  camera.far = snapshot.far;
  camera.zoom = snapshot.zoom;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

/**
 * @internal
 * Snapshot the camera now and restore it when `session` ends. The restore
 * is deferred one `requestAnimationFrame` tick because `WebXRManager` is
 * still tearing down render targets / camera-auto-update on the same tick
 * the session fires `'end'` — overwriting the camera mid-teardown produces
 * a frame at the wrong projection.
 */
export function attachBrowserCameraRestore(
  camera: PerspectiveCamera,
  session: XRSession,
): void {
  const snapshot = snapshotBrowserCamera(camera);
  const onEnd = () => {
    session.removeEventListener('end', onEnd);
    requestAnimationFrame(() => applyBrowserCameraSnapshot(camera, snapshot));
  };
  session.addEventListener('end', onEnd);
}
