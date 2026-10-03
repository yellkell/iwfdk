/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { FrameInput } from '../src/frame/frame-input.js';
import { pulseHaptics } from '../src/gamepad/haptics.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gamepadWith({
  playEffect,
  pulse,
}: {
  playEffect?: ReturnType<typeof vi.fn>;
  pulse?: ReturnType<typeof vi.fn>;
}): Gamepad {
  return {
    ...(playEffect ? { vibrationActuator: { playEffect } } : {}),
    ...(pulse ? { hapticActuators: [{ pulse }] } : {}),
  } as unknown as Gamepad;
}

describe('pulseHaptics', () => {
  it('prefers vibrationActuator.playEffect (Chromium XR on the Steam Frame)', () => {
    const playEffect = vi.fn().mockResolvedValue('complete');
    const pulse = vi.fn().mockResolvedValue(true);

    expect(pulseHaptics(gamepadWith({ playEffect, pulse }), 0.5, 40)).toBe(
      true,
    );

    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 40,
      strongMagnitude: 0.5,
      weakMagnitude: 0.5,
    });
    expect(pulse).not.toHaveBeenCalled();
  });

  it('uses hapticActuators[0].pulse where there is no vibrationActuator (Quest Browser)', () => {
    const pulse = vi.fn().mockResolvedValue(true);

    expect(pulseHaptics(gamepadWith({ pulse }), 0.8, 20)).toBe(true);

    expect(pulse).toHaveBeenCalledWith(0.8, 20);
  });

  it('falls back to pulse when playEffect rejects or throws', async () => {
    const pulse = vi.fn().mockResolvedValue(true);
    const rejecting = vi
      .fn()
      .mockRejectedValue(new DOMException('no', 'NotSupportedError'));
    expect(
      pulseHaptics(gamepadWith({ playEffect: rejecting, pulse }), 1, 10),
    ).toBe(true);
    await flush();
    expect(pulse).toHaveBeenCalledTimes(1);

    const throwing = vi.fn(() => {
      throw new TypeError('bad effect');
    });
    expect(
      pulseHaptics(gamepadWith({ playEffect: throwing, pulse }), 1, 10),
    ).toBe(true);
    expect(pulse).toHaveBeenCalledTimes(2);
  });

  it('accepts an XR input source and clamps the intensity', () => {
    const playEffect = vi.fn().mockResolvedValue('complete');
    const source = {
      handedness: 'right',
      gamepad: gamepadWith({ playEffect }),
    } as unknown as XRInputSource;

    expect(pulseHaptics(source, 3, -5)).toBe(true);

    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 0,
      strongMagnitude: 1,
      weakMagnitude: 1,
    });
  });

  it('returns false without a gamepad or an actuator', () => {
    expect(pulseHaptics(undefined, 1, 10)).toBe(false);
    expect(
      pulseHaptics({ handedness: 'left' } as unknown as XRInputSource, 1, 10),
    ).toBe(false);
    expect(pulseHaptics(gamepadWith({}), 1, 10)).toBe(false);
  });

  it('drives FrameInput.vibrate', () => {
    const playEffect = vi.fn().mockResolvedValue('complete');
    const frame = new FrameInput();
    frame.update({
      right: {
        gamepad: gamepadWith({ playEffect }),
        buttonMapping: new Map(),
        getButtonPressed: () => false,
        getButtonTouched: () => false,
        getButtonValue: () => 0,
        getAxesValues: () => undefined,
      },
    });

    expect(frame.vibrate('right', 0.25, 30)).toBe(true);
    expect(frame.vibrate('left', 0.25, 30)).toBe(false);
    expect(playEffect).toHaveBeenCalledWith('dual-rumble', {
      duration: 30,
      strongMagnitude: 0.25,
      weakMagnitude: 0.25,
    });
  });
});
