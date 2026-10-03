/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

// Reusable objects to avoid allocations in hot paths
const _m1 = new Matrix4();
const _q1 = new Quaternion();
const _position = new Vector3();
const _scale = new Vector3();

/**
 * Sets an object's position such that its world position matches the given world position.
 * Handles parent transforms correctly.
 *
 * @param object - The Object3D to set the position on
 * @param worldPosition - The desired world position
 */
export function setWorldPosition(
  object: Object3D,
  worldPosition: Vector3,
): void {
  const parent = object.parent;
  if (parent === null) {
    object.position.copy(worldPosition);
  } else {
    parent.updateWorldMatrix(true, false);
    _m1.copy(parent.matrixWorld).invert();
    object.position.copy(worldPosition).applyMatrix4(_m1);
  }
}

/**
 * Sets an object's quaternion such that its world quaternion matches the given world quaternion.
 * Handles parent transforms correctly, including parents with non-uniform scale.
 *
 * @param object - The Object3D to set the quaternion on
 * @param worldQuaternion - The desired world quaternion
 */
export function setWorldQuaternion(
  object: Object3D,
  worldQuaternion: Quaternion,
): void {
  const parent = object.parent;
  if (parent === null) {
    object.quaternion.copy(worldQuaternion);
  } else {
    parent.updateWorldMatrix(true, false);
    // Extract parent's world quaternion via decompose (handles non-uniform scale correctly)
    parent.matrixWorld.decompose(_position, _q1, _scale);
    object.quaternion.copy(worldQuaternion).premultiply(_q1.invert());
  }
}
