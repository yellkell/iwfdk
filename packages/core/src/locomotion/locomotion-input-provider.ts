/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { World } from '../ecs/world.js';
import { InputActions } from '../input/input-actions.js';
import { Quaternion, Vector2, Vector3 } from '../runtime/index.js';

const TURN_THRESHOLD = 0.8;

export type BrowserLocomotionControls =
  | boolean
  | {
      keyboard?: boolean;
      gamepad?: boolean;
      /** Reserved for a future pointer-lock camera adapter. */
      pointerLock?: false;
    };

/**
 * Converts low-level input actions into locomotion intent.
 *
 * Locomotion should not care whether input came from XR controllers, keyboard,
 * browser gamepads, or an app-authored adapter. This provider is the narrow
 * bridge between generic actions and the existing locomotor systems.
 */
export class ActionLocomotionInputProvider {
  constructor(private readonly world: World) {}

  enableBrowserControls(options: BrowserLocomotionControls): void {
    if (!options) {
      return;
    }

    const bindingOptions =
      typeof options === 'object'
        ? {
            keyboard: options.keyboard,
            gamepad: options.gamepad,
          }
        : undefined;

    this.world.input.actions.enableDefaultBindings(
      'browser-first-person',
      bindingOptions,
    );
  }

  getMoveAxis(out: Vector2): Vector2 {
    const value = this.world.input.actions.getAxis2D(
      InputActions.LocomotionMove,
    );
    return out.set(value.x, value.y);
  }

  getMovementReferenceQuaternion(out: Quaternion): Quaternion {
    if (this.world.session) {
      this.world.player.head.getWorldQuaternion(out);
    } else {
      this.world.camera.getWorldQuaternion(out);
    }
    return out;
  }

  getJumpDown(): boolean {
    return this.world.input.actions.getButtonDown(InputActions.LocomotionJump);
  }

  getTurnAxis(): number {
    return this.world.input.actions.getAxis1D(InputActions.LocomotionTurn);
  }

  getTurnLeftDown(microGestureControlsEnabled: boolean): boolean {
    if (this.isHandMicroGestureMode(microGestureControlsEnabled)) {
      return this.world.input.xr.gamepads.right?.getButtonDownByIdx(5) ?? false;
    }

    return this.world.input.actions.getAxis1DEnteringNegative(
      InputActions.LocomotionTurn,
      TURN_THRESHOLD,
    );
  }

  getTurnRightDown(microGestureControlsEnabled: boolean): boolean {
    if (this.isHandMicroGestureMode(microGestureControlsEnabled)) {
      return this.world.input.xr.gamepads.right?.getButtonDownByIdx(6) ?? false;
    }

    return this.world.input.actions.getAxis1DEnteringPositive(
      InputActions.LocomotionTurn,
      TURN_THRESHOLD,
    );
  }

  shouldShowTurnSignals(microGestureControlsEnabled: boolean): boolean {
    return this.isHandMicroGestureMode(microGestureControlsEnabled);
  }

  getTeleportActive(
    pointerBusy: boolean,
    microGestureControlsEnabled: boolean,
  ): boolean {
    if (pointerBusy) {
      return false;
    }

    if (this.world.input.xr.isPrimary('hand', 'right')) {
      return (
        microGestureControlsEnabled &&
        !(this.world.input.xr.gamepads.right?.getButtonDownByIdx(9) ?? false)
      );
    }

    return this.world.input.actions.getButtonPressed(
      InputActions.LocomotionTeleportAim,
    );
  }

  getTeleportCommit(microGestureControlsEnabled: boolean): boolean {
    if (this.world.input.xr.isPrimary('hand', 'right')) {
      return (
        microGestureControlsEnabled &&
        (this.world.input.xr.gamepads.right?.getButtonDownByIdx(9) ?? false)
      );
    }

    return this.world.input.actions.getButtonUp(
      InputActions.LocomotionTeleportAim,
    );
  }

  getTeleportRay(origin: Vector3, direction: Vector3): boolean {
    if (!this.world.session) {
      return false;
    }

    this.world.player.raySpaces.right.getWorldPosition(origin);
    this.world.player.raySpaces.right.getWorldDirection(direction);
    return true;
  }

  private isHandMicroGestureMode(
    microGestureControlsEnabled: boolean,
  ): boolean {
    return (
      microGestureControlsEnabled &&
      this.world.input.xr.isPrimary('hand', 'right')
    );
  }
}

export function getRequiredInputProvider(
  systemName: string,
  value: unknown,
): ActionLocomotionInputProvider {
  if (value instanceof ActionLocomotionInputProvider) {
    return value;
  }

  throw new Error(
    `${systemName} must be registered through LocomotionSystem so locomotion subsystems share one input provider.`,
  );
}
