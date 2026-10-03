/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types } from '../ecs/component.js';
import { createSystem } from '../ecs/system.js';
import { Group, Mesh, Vector3 } from '../runtime/index.js';
import { BeveledCylinderGeometry } from './geometries/beveled-cylinder.js';
import {
  ActionLocomotionInputProvider,
  getRequiredInputProvider,
} from './locomotion-input-provider.js';

const unitVector = new Vector3(1, 1, 1);

export enum TurningMethod {
  SnapTurn = 1,
  SmoothTurn = 2,
}

/**
 * Player yaw rotation via snap or smooth turning.
 *
 * @remarks
 * - When snap turning is active, visual turn signals render on the right ray
 *   and respond to thumbstick left/right or hand micro‑gestures (if enabled).
 * - Smooth turning applies a continuous yaw at `turningSpeed` degrees/second.
 *
 * @category Locomotion
 */
export class TurnSystem extends createSystem(
  {},
  {
    /** Choose snap or smooth turning. */
    turningMethod: { type: Types.Int8, default: TurningMethod.SnapTurn },
    /** Degrees to rotate per snap. */
    turningAngle: { type: Types.Float32, default: 45 },
    /** Degrees per second when smooth turning. */
    turningSpeed: { type: Types.Float32, default: 180 },
    /** Enable swipe‑gesture turning in hand‑tracking mode. */
    microGestureControlsEnabled: { type: Types.Boolean, default: false },
    /** Action-backed input provider shared across locomotion systems. */
    inputProvider: { type: Types.Object, default: undefined },
  },
) {
  private turnSignals = new Group();
  private leftSignal = new Mesh(
    new BeveledCylinderGeometry(0.004, 0.012, 0.022, 4, 0.004).rotateZ(
      Math.PI / 2,
    ),
  );
  private rightSignal = new Mesh(
    new BeveledCylinderGeometry(0.004, 0.012, 0.022, 4, 0.004).rotateZ(
      -Math.PI / 2,
    ),
  );
  private playerHeadPosition = new Vector3();
  private inputProvider!: ActionLocomotionInputProvider;

  init() {
    this.inputProvider = getRequiredInputProvider(
      'TurnSystem',
      this.config.inputProvider.value,
    );
    this.turnSignals.add(this.leftSignal, this.rightSignal);
    this.leftSignal.position.set(-0.015, 0.02, 0);
    this.rightSignal.position.set(0.055, 0.02, 0);
    this.cleanupFuncs.push(
      this.config.turningMethod.subscribe((value) => {
        if (value === TurningMethod.SmoothTurn) {
          this.turnSignals.removeFromParent();
        } else {
          this.player.raySpaces.right.add(this.turnSignals);
        }
      }),
    );
  }

  destroy(): void {
    super.destroy();
    this.turnSignals.removeFromParent();
  }

  update(delta: number): void {
    if (this.config.turningMethod.value === TurningMethod.SmoothTurn) {
      this.updateSmooth(delta);
    } else {
      this.updateSnap(delta);
    }
  }

  private updateSmooth(delta: number): void {
    const turnAxis = this.inputProvider.getTurnAxis();
    const turningSpeedRadian = (this.config.turningSpeed.value / 180) * Math.PI;
    if (turnAxis !== 0) {
      this.player.rotateY(-turnAxis * turningSpeedRadian * delta);
    }
  }

  private updateSnap(delta: number): void {
    const turningAngleRadian = (this.config.turningAngle.value / 180) * Math.PI;
    const showSignals = this.inputProvider.shouldShowTurnSignals(
      this.config.microGestureControlsEnabled.value,
    );
    this.turnSignals.visible = showSignals;
    if (showSignals) {
      this.player.head.getWorldPosition(this.playerHeadPosition);
      this.turnSignals.lookAt(this.playerHeadPosition);
    } else {
      this.turnSignals.visible = false;
    }

    const turningLeft = this.inputProvider.getTurnLeftDown(
      this.config.microGestureControlsEnabled.value,
    );
    const turningRight = this.inputProvider.getTurnRightDown(
      this.config.microGestureControlsEnabled.value,
    );

    if (turningLeft) {
      this.player.rotateY(turningAngleRadian);
      if (this.turnSignals.visible) {
        this.leftSignal.scale.setScalar(1.5);
      }
    } else if (turningRight) {
      this.player.rotateY(-turningAngleRadian);
      if (this.turnSignals.visible) {
        this.rightSignal.scale.setScalar(1.5);
      }
    }
    if (this.turnSignals.visible) {
      this.leftSignal.scale.lerp(unitVector, 5 * delta);
      this.rightSignal.scale.lerp(unitVector, 5 * delta);
    }
  }
}
