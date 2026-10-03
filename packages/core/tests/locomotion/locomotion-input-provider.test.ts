/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { ActionLocomotionInputProvider } from '../../src/locomotion/locomotion-input-provider.js';
import {
  Group,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from '../../src/runtime/index.js';

vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 0,
      }),
    }),
  };
});

function createWorld() {
  const camera = new PerspectiveCamera();
  const head = new Group();
  const ray = new Group();

  return {
    camera,
    session: undefined as XRSession | undefined,
    player: {
      head,
      raySpaces: { right: ray },
    },
    input: {
      actions: {
        enableDefaultBindings: vi.fn(),
        getAxis2D: () => ({ x: 0, y: 0 }),
        getButtonDown: () => false,
        getAxis1D: () => 0,
        getAxis1DEnteringNegative: () => false,
        getAxis1DEnteringPositive: () => false,
        getButtonPressed: () => false,
        getButtonUp: () => false,
      },
      xr: {
        isPrimary: () => false,
        gamepads: { right: undefined },
      },
    },
  } as any;
}

describe('ActionLocomotionInputProvider', () => {
  it('enables browser-first action bindings only when requested', () => {
    const world = createWorld();
    const provider = new ActionLocomotionInputProvider(world);

    provider.enableBrowserControls(false);
    expect(world.input.actions.enableDefaultBindings).not.toHaveBeenCalled();

    provider.enableBrowserControls({ keyboard: true, gamepad: false });
    expect(world.input.actions.enableDefaultBindings).toHaveBeenCalledWith(
      'browser-first-person',
      { keyboard: true, gamepad: false },
    );
  });

  it('uses camera orientation outside XR and head orientation during XR', () => {
    const world = createWorld();
    const provider = new ActionLocomotionInputProvider(world);
    const out = new Quaternion();

    world.camera.rotation.y = Math.PI / 2;
    provider.getMovementReferenceQuaternion(out);
    expect(out.y).toBeCloseTo(Math.sin(Math.PI / 4));

    world.session = {} as XRSession;
    world.player.head.rotation.y = -Math.PI / 2;
    provider.getMovementReferenceQuaternion(out);
    expect(out.y).toBeCloseTo(Math.sin(-Math.PI / 4));
  });

  it('forwards jump and turn action state', () => {
    const world = createWorld();
    world.input.actions.getButtonDown = vi.fn(() => true);
    world.input.actions.getAxis1D = vi.fn(() => -0.5);
    world.input.actions.getAxis1DEnteringNegative = vi.fn(() => true);
    const provider = new ActionLocomotionInputProvider(world);

    expect(provider.getJumpDown()).toBe(true);
    expect(provider.getTurnAxis()).toBe(-0.5);
    expect(provider.getTurnLeftDown(false)).toBe(true);
    expect(world.input.actions.getAxis1DEnteringNegative).toHaveBeenCalled();
  });

  it('uses hand micro-gesture buttons when enabled', () => {
    const world = createWorld();
    world.input.actions.getAxis1DEnteringNegative = vi.fn(() => false);
    world.input.xr.isPrimary = vi.fn(() => true);
    world.input.xr.gamepads.right = {
      getButtonDownByIdx: vi.fn((index: number) => index === 5),
    };
    const provider = new ActionLocomotionInputProvider(world);

    expect(provider.shouldShowTurnSignals(true)).toBe(true);
    expect(provider.getTurnLeftDown(true)).toBe(true);
    expect(provider.getTurnRightDown(true)).toBe(false);
    expect(
      world.input.actions.getAxis1DEnteringNegative,
    ).not.toHaveBeenCalled();
  });

  it('does not provide a teleport ray outside XR', () => {
    const world = createWorld();
    const provider = new ActionLocomotionInputProvider(world);
    const origin = new Vector3(1, 2, 3);
    const direction = new Vector3(0, 1, 0);

    expect(provider.getTeleportRay(origin, direction)).toBe(false);
    expect(origin.toArray()).toEqual([1, 2, 3]);
    expect(direction.toArray()).toEqual([0, 1, 0]);
  });

  it('uses the right ray space for teleport during XR', () => {
    const world = createWorld();
    world.session = {} as XRSession;
    world.player.raySpaces.right.position.set(2, 3, 4);
    const provider = new ActionLocomotionInputProvider(world);
    const origin = new Vector3();
    const direction = new Vector3();

    expect(provider.getTeleportRay(origin, direction)).toBe(true);
    expect(origin.toArray()).toEqual([2, 3, 4]);
    expect(direction.length()).toBeCloseTo(1);
  });
});
