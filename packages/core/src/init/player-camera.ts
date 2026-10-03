/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Object3D, PerspectiveCamera } from '../runtime/index.js';

export function attachCameraToPlayer(
  player: Object3D,
  camera: PerspectiveCamera,
): void {
  if (camera.parent !== player) {
    player.add(camera);
  }
}
