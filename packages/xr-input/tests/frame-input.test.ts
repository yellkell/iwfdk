/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { FrameInput } from '../src/frame/frame-input.js';
import {
  FrameButton,
  analogPress,
  stickToDpad,
} from '../src/frame/hysteresis.js';
import { PinchDetector, type PinchJoints } from '../src/frame/pinch.js';
import { loadInputProfile } from '../src/gamepad/input-profiles.js';
import { StatefulGamepad } from '../src/gamepad/stateful-gamepad.js';

// Ports of FramePlayer's fp-xr unit tests (crates/xr/src/{input,pinch}.rs).

describe('FrameButton', () => {
  it('tracks edges and touch', () => {
    const b = new FrameButton();
    b.update(true, false);
    expect(b.pressed && b.justPressed && b.touched).toBe(true);
    b.update(true, true);
    expect(b.justPressed).toBe(false);
    b.update(false, true);
    expect(b.justReleased && b.touched && !b.pressed).toBe(true);
    b.update(false, false);
    expect(b.justReleased || b.touched).toBe(false);
  });
});

describe('analogPress', () => {
  it('applies hysteresis', () => {
    expect(analogPress(false, 0.65, 0.7, 0.5)).toBe(false);
    expect(analogPress(false, 0.7, 0.7, 0.5)).toBe(true);
    expect(analogPress(true, 0.6, 0.7, 0.5)).toBe(true);
    expect(analogPress(true, 0.5, 0.7, 0.5)).toBe(false);
  });
});

describe('stickToDpad', () => {
  const none = [false, false, false, false] as const;
  it('emulates a D-pad from the dominant axis with hysteresis', () => {
    expect(stickToDpad(0, 0.9, none, 0.7)).toEqual([true, false, false, false]);
    expect(stickToDpad(-0.9, 0.3, none, 0.7)).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(stickToDpad(0.5, 0.2, none, 0.7)).toEqual(none);
    const right = [false, false, false, true] as const;
    expect(stickToDpad(0.6, 0, right, 0.7)).toEqual(right);
    expect(stickToDpad(0.4, 0, right, 0.7)).toEqual(none);
    expect(stickToDpad(0.75, -0.8, none, 0.7)).toEqual([
      false,
      true,
      false,
      false,
    ]);
  });
});

describe('PinchDetector', () => {
  // Radii of 5 mm each; centre distance = gap + 10 mm.
  const at = (gap: number): PinchJoints => ({
    thumb: { x: 0, y: 0, z: 0 },
    thumbRadius: 0.005,
    index: { x: gap + 0.01, y: 0, z: 0 },
    indexRadius: 0.005,
  });

  it('engages and releases with hysteresis', () => {
    const d = new PinchDetector();
    expect(d.update(at(0.05)).pinching).toBe(false);
    expect(d.update(at(0.015)).pinching).toBe(false);
    let s = d.update(at(0.005));
    expect(s.pinching && s.justPinched).toBe(true);
    s = d.update(at(0.02));
    expect(s.pinching && !s.justPinched).toBe(true);
    s = d.update(at(0.03));
    expect(!s.pinching && s.justReleased).toBe(true);
    expect(d.update(at(0.02)).pinching).toBe(false);
  });

  it('releases on tracking loss', () => {
    const d = new PinchDetector();
    expect(d.update(at(0)).justPinched).toBe(true);
    const s = d.update(undefined);
    expect(!s.pinching && s.justReleased && s.strength === 0).toBe(true);
  });

  it('has monotonic strength', () => {
    expect(new PinchDetector().update(at(0)).strength).toBe(1);
    expect(new PinchDetector().update(at(0.2)).strength).toBe(0);
    let prev = 1;
    for (let i = 0; i < 100; i++) {
      const s = new PinchDetector().update(at(i * 0.001)).strength;
      expect(s).toBeLessThanOrEqual(prev);
      prev = s;
    }
  });
});

// Scenario tests through real StatefulGamepads built from each profile.

type Pad = {
  buttons: { pressed: boolean; touched: boolean; value: number }[];
  axes: number[];
};

function rig(
  profiles: string[],
  buttonCount: number,
): {
  pads: Record<'left' | 'right', Pad>;
  gamepads: Record<'left' | 'right', StatefulGamepad>;
  sync: () => void;
} {
  const pads = {} as Record<'left' | 'right', Pad>;
  const gamepads = {} as Record<'left' | 'right', StatefulGamepad>;
  for (const handedness of ['left', 'right'] as const) {
    const pad: Pad = {
      buttons: Array.from({ length: buttonCount }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
      axes: [0, 0, 0, 0],
    };
    const inputSource = {
      profiles,
      handedness,
      gamepad: pad,
    } as unknown as XRInputSource;
    pads[handedness] = pad;
    gamepads[handedness] = new StatefulGamepad(loadInputProfile(inputSource));
  }
  return {
    pads,
    gamepads,
    sync: () => {
      gamepads.left.update();
      gamepads.right.update();
    },
  };
}

function press(pad: Pad, index: number, pressed = true) {
  pad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
}

describe('FrameInput on valve-frame', () => {
  it('maps every Frame control to its physical source', () => {
    const { pads, gamepads, sync } = rig(
      ['valve-frame', 'generic-trigger-squeeze-thumbstick'],
      10,
    );
    const input = new FrameInput({ userAgent: 'X11; Linux aarch64' });

    press(pads.right, 4); // A
    press(pads.right, 7); // Y
    press(pads.right, 9); // menu
    press(pads.left, 5); // D-pad down
    press(pads.left, 8); // left shoulder
    press(pads.left, 9); // view
    sync();
    input.update(gamepads);

    expect(input.layout).toBe('frame');
    expect(input.dpadEmulated).toBe(false);
    expect(input.a.justPressed && input.y.pressed && input.menu.pressed).toBe(
      true,
    );
    expect(input.b.pressed || input.x.pressed).toBe(false);
    expect(input.dpad.down.pressed && !input.dpad.up.pressed).toBe(true);
    expect(input.view.pressed && input.left.shoulder.pressed).toBe(true);
    expect(input.right.shoulder.pressed).toBe(false);
    expect(input.left.profileId).toBe('valve-frame');

    press(pads.right, 4, false);
    sync();
    input.update(gamepads);
    expect(input.a.justReleased).toBe(true);
  });

  it('derives select and grip with hysteresis', () => {
    const { pads, gamepads, sync } = rig(['valve-frame'], 10);
    const input = new FrameInput();
    pads.right.buttons[0] = { pressed: false, touched: true, value: 0.8 };
    pads.right.buttons[1] = { pressed: false, touched: false, value: 0.72 };
    sync();
    input.update(gamepads);
    expect(input.right.select.pressed && input.right.select.touched).toBe(true);
    expect(input.right.grip.justPressed).toBe(true);

    pads.right.buttons[0].value = 0.65;
    pads.right.buttons[1].value = 0.55;
    sync();
    input.update(gamepads);
    expect(input.right.select.pressed && input.right.grip.pressed).toBe(true);

    pads.right.buttons[0].value = 0.5;
    pads.right.buttons[1].value = 0.4;
    sync();
    input.update(gamepads);
    expect(
      input.right.select.justReleased && input.right.grip.justReleased,
    ).toBe(true);
  });
});

describe('FrameInput on an unpatched Frame browser', () => {
  it('maps SteamVR Touch emulation and emulates the D-pad', () => {
    const { pads, gamepads, sync } = rig(
      ['oculus-touch', 'generic-trigger-squeeze-thumbstick'],
      7,
    );
    const input = new FrameInput({ userAgent: 'X11; Linux aarch64' });
    press(pads.right, 4); // A
    press(pads.left, 5); // Y
    pads.left.axes[2] = 0.9; // Stick right.
    sync();
    input.update(gamepads);
    expect(input.layout).toBe('remapped');
    expect(input.a.pressed && input.y.pressed).toBe(true);
    expect(input.dpadEmulated && input.dpad.right.pressed).toBe(true);
    expect(input.left.shoulder.pressed || input.view.pressed).toBe(false);
  });

  it('emulates the D-pad with hysteresis', () => {
    const { pads, gamepads, sync } = rig(['oculus-touch'], 7);
    const input = new FrameInput({ userAgent: 'X11; Linux aarch64' });
    pads.left.axes[3] = -0.9; // Stick pushed up (gamepad y is down-positive).
    sync();
    input.update(gamepads);
    expect(input.dpad.up.justPressed).toBe(true);
    expect(input.left.thumbstick.y).toBeCloseTo(-0.9);

    pads.left.axes[3] = -0.6; // Held above the release threshold.
    sync();
    input.update(gamepads);
    expect(input.dpad.up.pressed).toBe(true);
    pads.left.axes[3] = -0.3;
    sync();
    input.update(gamepads);
    expect(input.dpad.up.justReleased).toBe(true);
  });

  it('reports Touch controllers elsewhere as other', () => {
    const { gamepads, sync } = rig(['oculus-touch-v3'], 7);
    const input = new FrameInput({ userAgent: 'X11; Linux x86_64' });
    sync();
    input.update(gamepads);
    expect(input.layout).toBe('other');
  });
});

describe('FrameInput on Touch-style controllers', () => {
  it('takes X/Y from the left controller', () => {
    const { pads, gamepads, sync } = rig(['oculus-touch-v3'], 7);
    const input = new FrameInput();
    press(pads.left, 4); // X
    press(pads.left, 5); // Y
    press(pads.right, 5); // B
    sync();
    input.update(gamepads);
    expect(input.layout).toBe('other');
    expect(input.x.pressed && input.y.pressed && input.b.pressed).toBe(true);
    expect(input.a.pressed).toBe(false);
  });
});

describe('FrameInput without controllers', () => {
  it('resets state when a gamepad disappears', () => {
    const { pads, gamepads, sync } = rig(['valve-frame'], 10);
    const input = new FrameInput();
    press(pads.right, 4);
    pads.right.axes[2] = 0.5;
    sync();
    input.update(gamepads);
    expect(input.right.active && input.a.pressed).toBe(true);

    input.update({});
    expect(input.layout).toBe('none');
    expect(input.right.active).toBe(false);
    expect(input.right.thumbstick.x).toBe(0);
    expect(input.a.justReleased).toBe(true);
  });
});

describe('FrameInput.updateHands', () => {
  const joint = (name: string) => ({ jointName: name });
  const pose = (x: number) => ({
    transform: { position: { x, y: 0, z: 0 } },
    radius: 0.005,
  });
  const hand = new Map([
    ['thumb-tip', joint('thumb-tip')],
    ['index-finger-tip', joint('index-finger-tip')],
  ]);

  it('pinches from joint poses and releases when untracked', () => {
    const input = new FrameInput();
    const source = { handedness: 'right', hand } as unknown as XRInputSource;
    const frame = {
      getJointPose: (j: { jointName: string }) =>
        j.jointName === 'thumb-tip' ? pose(0) : pose(0.012),
    } as unknown as XRFrame;
    input.updateHands(frame, {} as XRSpace, [source]);
    expect(input.hands.right.tracked).toBe(true);
    expect(input.hands.right.pinch.justPinched).toBe(true);
    expect(input.hands.left.tracked).toBe(false);

    input.updateHands(frame, {} as XRSpace, []);
    expect(input.hands.right.pinch.justReleased).toBe(true);
  });
});
