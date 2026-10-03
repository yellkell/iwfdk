/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pinch detection from hand-tracking joints with hysteresis, so a pinch held
 * near the threshold does not chatter. Port of FramePlayer's `fp-xr` pinch
 * detector.
 *
 * Distances are between the thumb-tip and index-tip joint *surfaces* (centre
 * distance minus both joint radii), in metres.
 */
export interface PinchConfig {
  /** Gap below which a pinch starts. */
  engage: number;
  /** Gap above which a pinch ends. Must exceed `engage`. */
  release: number;
  /** Gap at which `strength` reaches 0. */
  open: number;
}

// [verify] Tune against Frame hand-tracking noise.
export const DEFAULT_PINCH_CONFIG: Readonly<PinchConfig> = {
  engage: 0.01,
  release: 0.025,
  open: 0.08,
};

export interface PinchState {
  pinching: boolean;
  justPinched: boolean;
  justReleased: boolean;
  /** 0 = open hand … 1 = touching. */
  strength: number;
}

/** Thumb and index tip positions and joint radii. */
export interface PinchJoints {
  thumb: { x: number; y: number; z: number };
  thumbRadius: number;
  index: { x: number; y: number; z: number };
  indexRadius: number;
}

export class PinchDetector {
  config: PinchConfig;
  private pinching = false;

  constructor(config: PinchConfig = DEFAULT_PINCH_CONFIG) {
    this.config = { ...config };
  }

  /** Feed one frame. `undefined` (hand not tracked) releases any pinch. */
  update(joints: PinchJoints | undefined): PinchState {
    const was = this.pinching;
    let gap = Infinity;
    if (joints) {
      const dx = joints.thumb.x - joints.index.x;
      const dy = joints.thumb.y - joints.index.y;
      const dz = joints.thumb.z - joints.index.z;
      gap = Math.max(
        0,
        Math.sqrt(dx * dx + dy * dy + dz * dz) -
          joints.thumbRadius -
          joints.indexRadius,
      );
    }
    if (!joints) {
      this.pinching = false;
    } else if (was) {
      this.pinching = gap < this.config.release;
    } else {
      this.pinching = gap < this.config.engage;
    }
    const span = Math.max(this.config.open - this.config.engage, 1e-6);
    const strength = joints
      ? Math.min(1, Math.max(0, 1 - (gap - this.config.engage) / span))
      : 0;
    return {
      pinching: this.pinching,
      justPinched: this.pinching && !was,
      justReleased: !this.pinching && was,
      strength,
    };
  }

  isPinching(): boolean {
    return this.pinching;
  }
}
