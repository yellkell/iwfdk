/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

interface HapticPulseActuator {
  pulse?: (value: number, duration: number) => Promise<boolean>;
}

type HapticGamepad = Gamepad & {
  /** Older Gamepad Extensions API; what Meta Quest Browser implements. */
  hapticActuators?: ReadonlyArray<HapticPulseActuator>;
};

/**
 * Vibrate a controller once. Best effort: returns false when the browser
 * exposes no haptic actuator for it.
 *
 * Browsers differ in how XR controllers vibrate, so both APIs are tried:
 * - `gamepad.vibrationActuator.playEffect('dual-rumble', ...)`, the current
 *   Gamepad API. The Steam Frame's Chromium XR browser supports this one only
 *   (Chromium patch 0008); if the effect is rejected, the pulse below is
 *   tried instead.
 * - `gamepad.hapticActuators[0].pulse(...)`, the older Gamepad Extensions API
 *   that Meta Quest Browser implements.
 *
 * @param target The controller's input source or its gamepad.
 * @param intensity Strength, 0…1 (clamped).
 * @param durationMs Duration in milliseconds.
 * @category Input
 */
export function pulseHaptics(
  target: XRInputSource | Gamepad | null | undefined,
  intensity: number,
  durationMs: number,
): boolean {
  const gamepad = (
    target && 'handedness' in target ? target.gamepad : target
  ) as HapticGamepad | null | undefined;
  if (!gamepad) {
    return false;
  }
  const value = Math.min(1, Math.max(0, intensity || 0));
  const duration = Math.max(0, durationMs || 0);

  const pulse = () => {
    const actuator = gamepad.hapticActuators?.[0];
    if (typeof actuator?.pulse !== 'function') {
      return false;
    }
    void Promise.resolve(actuator.pulse(value, duration)).catch(() => {});
    return true;
  };

  const vibration = gamepad.vibrationActuator;
  if (typeof vibration?.playEffect === 'function') {
    try {
      void Promise.resolve(
        vibration.playEffect('dual-rumble', {
          duration,
          strongMagnitude: value,
          weakMagnitude: value,
        }),
      ).catch(() => pulse());
      return true;
    } catch {
      // Fall through to the older API.
    }
  }
  return pulse();
}
