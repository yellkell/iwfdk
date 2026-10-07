/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { XRDevice as XRDeviceType } from 'iwer';
import { beforeAll, describe, expect, it } from 'vitest';
import { steamFrameDeviceConfig } from '../../frame-kit/steam-frame-emulator.js';
import { isSteamFrameBrowser } from '../../xr-input/src/frame/platform.js';
import {
  ValveFrameButtonCount,
  ValveFrameGamepadIndex,
} from '../../xr-input/src/gamepad/profiles/valve-frame.js';
// @ts-expect-error plain JS module without types
import { extendGamepadTools } from '../src/gamepad-remote.js';
import {
  mirrorFrameXY,
  steamFrame,
  steamFrameTouch,
  valveFrameController,
} from '../src/steam-frame-device.js';

let XRDevice: typeof XRDeviceType;
let metaQuest3: ConstructorParameters<typeof XRDeviceType>[0];

beforeAll(async () => {
  // IWER's XRDevice builds a DOM canvas container; Node only needs a stub.
  const element = () => ({
    style: {},
    dataset: {},
    appendChild() {},
    addEventListener() {},
    getContext: () => null,
  });
  (globalThis as { document?: unknown }).document ??= {
    createElement: element,
  };
  ({ XRDevice, metaQuest3 } = await import('iwer'));
});

type Remote = {
  executeGetGamepadState(params: object): {
    buttons: { index: number; name: string; value: number }[];
  };
  executeSetGamepadState(params: object): { buttonsSet: number };
};

function frameDevice() {
  const device = new XRDevice(steamFrame);
  mirrorFrameXY(device);
  extendGamepadTools(device);
  return device;
}

function buttonIds(hand: 'left' | 'right') {
  return valveFrameController.layout[hand]!.gamepad.buttons.map(
    (button) => button?.id ?? null,
  );
}

function pressed(device: XRDeviceType, hand: 'left' | 'right') {
  const ids = buttonIds(hand);
  return ids.filter(
    (id) => id && device.controllers[hand]!.getButtonValue(id) > 0,
  );
}

describe('steamFrame emulated device', () => {
  it('lays out the gamepads as the valve-frame profile does', () => {
    const left = buttonIds('left');
    const right = buttonIds('right');
    expect(left).toHaveLength(ValveFrameButtonCount.left);
    expect(right).toHaveLength(ValveFrameButtonCount.right);

    const I = ValveFrameGamepadIndex;
    for (const ids of [left, right]) {
      expect(ids[I.Trigger]).toBe('trigger');
      expect(ids[I.Squeeze]).toBe('squeeze');
      expect(ids[I.Thumbstick]).toBe('thumbstick');
      expect(ids[2]).toBeNull();
      expect(ids[6]).toBeNull();
    }
    expect(right[I.A]).toBe('a-button');
    expect(right[I.B]).toBe('b-button');
    expect(right[I.X]).toBe('x-button');
    expect(right[I.Y]).toBe('y-button');
    expect(right[I.RightShoulder]).toBe('shoulder');
    expect(right[I.Menu]).toBe('menu');
    expect(left[I.MirroredX]).toBe('x-button');
    expect(left[I.MirroredY]).toBe('y-button');
    expect(left[I.DpadUp]).toBe('dpad-up');
    expect(left[I.DpadDown]).toBe('dpad-down');
    expect(left[I.DpadLeft]).toBe('dpad-left');
    expect(left[I.DpadRight]).toBe('dpad-right');
    expect(left[I.LeftShoulder]).toBe('shoulder');
    expect(left[I.View]).toBe('view');

    const axes = valveFrameController.layout.left!.gamepad.axes;
    expect(axes[I.ThumbstickXAxis]).toEqual({
      id: 'thumbstick',
      type: 'x-axis',
    });
    expect(axes[I.ThumbstickYAxis]).toEqual({
      id: 'thumbstick',
      type: 'y-axis',
    });
  });

  it('reports the profiles Chromium XR reports', () => {
    expect([
      valveFrameController.profileId,
      ...valveFrameController.fallbackProfileIds,
    ]).toEqual([
      'valve-frame',
      'oculus-touch-v3',
      'oculus-touch',
      'generic-trigger-squeeze-thumbstick',
    ]);
    expect(steamFrameTouch.controllerConfig?.profileId).toBe('oculus-touch');
  });

  it('is a Steam Frame browser to IWFDK, and offers no AR', () => {
    for (const config of [steamFrame, steamFrameTouch]) {
      expect(isSteamFrameBrowser(config.userAgent)).toBe(true);
      expect(config.supportedSessionModes).not.toContain('immersive-ar');
      expect(config.supportedFeatures).not.toContain('layers');
      expect(config.supportedFeatures).not.toContain('hit-test');
      expect(config.supportedFeatures).not.toContain('anchors');
    }
  });

  it('mirrors X and Y from either controller onto both', () => {
    const device = frameDevice();
    device.controllers.right!.updateButtonValue('x-button', 1);
    expect(pressed(device, 'right')).toEqual(['x-button']);
    expect(pressed(device, 'left')).toEqual(['x-button']);

    device.controllers.left!.updateButtonValue('x-button', 0);
    device.controllers.left!.updateButtonValue('y-button', 1);
    expect(pressed(device, 'right')).toEqual(['y-button']);
    expect(pressed(device, 'left')).toEqual(['y-button']);

    device.controllers.right!.updateButtonValue('a-button', 1);
    expect(pressed(device, 'left')).toEqual(['y-button']);
  });
});

describe('extended gamepad tools', () => {
  it('lists the Frame-only buttons after the six Touch ones', () => {
    const remote = frameDevice().remote as unknown as Remote;
    const names = (device: string) =>
      remote
        .executeGetGamepadState({ device })
        .buttons.map(({ index, name }) => `${index}:${name}`);
    expect(names('controller-right')).toEqual([
      '0:trigger',
      '1:squeeze',
      '2:thumbstick',
      '3:a',
      '4:b',
      '5:thumbrest',
      '6:x',
      '7:y',
      '8:shoulder',
      '9:menu',
    ]);
    expect(names('controller-left').slice(6)).toEqual([
      '6:dpad-up',
      '7:dpad-down',
      '8:dpad-left',
      '9:dpad-right',
      '10:shoulder',
      '11:view',
    ]);
  });

  it('presses buttons by name or by an index past the Touch ones', () => {
    const device = frameDevice();
    const remote = device.remote as unknown as Remote;
    const result = remote.executeSetGamepadState({
      device: 'controller-left',
      buttons: [
        { name: 'dpad-up', value: 1 },
        { index: 11, value: 1 },
        { index: 0, value: 0.5 },
      ],
    });
    expect(result.buttonsSet).toBe(3);
    expect(pressed(device, 'left')).toEqual(['trigger', 'dpad-up', 'view']);

    remote.executeSetGamepadState({
      device: 'controller-right',
      buttons: [{ name: 'x', value: 1 }],
    });
    expect(pressed(device, 'right')).toEqual(['x-button']);
    expect(pressed(device, 'left')).toContain('x-button');

    const state = remote.executeGetGamepadState({ device: 'controller-left' });
    expect(state.buttons.find((b) => b.name === 'dpad-up')?.value).toBe(1);
  });

  it('names the available buttons when a name is unknown', () => {
    const remote = frameDevice().remote as unknown as Remote;
    expect(() =>
      remote.executeSetGamepadState({
        device: 'controller-right',
        buttons: [{ name: 'dpad-up', value: 1 }],
      }),
    ).toThrow(/no button "dpad-up".*shoulder, menu/);
  });

  it('leaves Quest controllers as IWER describes them', () => {
    const device = new XRDevice(metaQuest3);
    extendGamepadTools(device);
    const remote = device.remote as unknown as Remote;
    expect(
      remote.executeGetGamepadState({ device: 'controller-right' }).buttons,
    ).toHaveLength(6);
    remote.executeSetGamepadState({
      device: 'controller-left',
      buttons: [{ name: 'x', value: 1 }],
    });
    expect(device.controllers.left!.getButtonValue('x-button')).toBe(1);
  });
});

describe('frame-kit emulator', () => {
  it('emulates the same devices as the dev server', async () => {
    const iwer = await import('iwer');
    expect(steamFrameDeviceConfig(iwer, 'steamFrame')).toEqual(steamFrame);
    expect(steamFrameDeviceConfig(iwer, 'steamFrameTouch')).toEqual(
      steamFrameTouch,
    );
  });
});
