/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { attachCameraToPlayer } from '../../src/init/player-camera.js';
import { Group, PerspectiveCamera, Scene } from '../../src/runtime/index.js';

describe('World player/camera invariant', () => {
  it('keeps the main camera under the player origin', () => {
    const scene = new Scene();
    const player = new Group();
    const camera = new PerspectiveCamera();

    scene.add(player);
    attachCameraToPlayer(player, camera);

    expect(player.parent).toBe(scene);
    expect(camera.parent).toBe(player);
  });
});
