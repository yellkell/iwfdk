/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ButtonAxesLayout, StatefulButtonAxesDevice } from '@iwsdk/xr-input';

export enum BrowserGamepadButton {
  South = 'standard-south',
  East = 'standard-east',
  West = 'standard-west',
  North = 'standard-north',
  LeftBumper = 'standard-left-bumper',
  RightBumper = 'standard-right-bumper',
  LeftTrigger = 'standard-left-trigger',
  RightTrigger = 'standard-right-trigger',
  Select = 'standard-select',
  Start = 'standard-start',
  LeftStick = 'standard-left-stick',
  RightStick = 'standard-right-stick',
  DPadUp = 'standard-dpad-up',
  DPadDown = 'standard-dpad-down',
  DPadLeft = 'standard-dpad-left',
  DPadRight = 'standard-dpad-right',
  Home = 'standard-home',
}

export enum BrowserGamepadAxis {
  LeftStick = 'standard-left-stick-axes',
  RightStick = 'standard-right-stick-axes',
}

const STANDARD_GAMEPAD_LAYOUT: ButtonAxesLayout = {
  selectComponentId: BrowserGamepadButton.South,
  components: {
    [BrowserGamepadButton.South]: {
      type: 'button',
      gamepadIndices: { button: 0 },
    },
    [BrowserGamepadButton.East]: {
      type: 'button',
      gamepadIndices: { button: 1 },
    },
    [BrowserGamepadButton.West]: {
      type: 'button',
      gamepadIndices: { button: 2 },
    },
    [BrowserGamepadButton.North]: {
      type: 'button',
      gamepadIndices: { button: 3 },
    },
    [BrowserGamepadButton.LeftBumper]: {
      type: 'button',
      gamepadIndices: { button: 4 },
    },
    [BrowserGamepadButton.RightBumper]: {
      type: 'button',
      gamepadIndices: { button: 5 },
    },
    [BrowserGamepadButton.LeftTrigger]: {
      type: 'trigger',
      gamepadIndices: { button: 6 },
    },
    [BrowserGamepadButton.RightTrigger]: {
      type: 'trigger',
      gamepadIndices: { button: 7 },
    },
    [BrowserGamepadButton.Select]: {
      type: 'button',
      gamepadIndices: { button: 8 },
    },
    [BrowserGamepadButton.Start]: {
      type: 'button',
      gamepadIndices: { button: 9 },
    },
    [BrowserGamepadButton.LeftStick]: {
      type: 'button',
      gamepadIndices: { button: 10 },
    },
    [BrowserGamepadButton.RightStick]: {
      type: 'button',
      gamepadIndices: { button: 11 },
    },
    [BrowserGamepadButton.DPadUp]: {
      type: 'button',
      gamepadIndices: { button: 12 },
    },
    [BrowserGamepadButton.DPadDown]: {
      type: 'button',
      gamepadIndices: { button: 13 },
    },
    [BrowserGamepadButton.DPadLeft]: {
      type: 'button',
      gamepadIndices: { button: 14 },
    },
    [BrowserGamepadButton.DPadRight]: {
      type: 'button',
      gamepadIndices: { button: 15 },
    },
    [BrowserGamepadButton.Home]: {
      type: 'button',
      gamepadIndices: { button: 16 },
    },
    [BrowserGamepadAxis.LeftStick]: {
      type: 'thumbstick',
      gamepadIndices: { xAxis: 0, yAxis: 1 },
    },
    [BrowserGamepadAxis.RightStick]: {
      type: 'thumbstick',
      gamepadIndices: { xAxis: 2, yAxis: 3 },
    },
  },
};

export class StatefulBrowserGamepad extends StatefulButtonAxesDevice {
  public gamepad: Gamepad;

  constructor(gamepad: Gamepad) {
    super(STANDARD_GAMEPAD_LAYOUT, gamepad.buttons.length);
    this.gamepad = gamepad;
  }

  get index(): number {
    return this.gamepad.index;
  }

  get id(): string {
    return this.gamepad.id;
  }

  get connected(): boolean {
    return this.gamepad.connected;
  }

  get mapping(): GamepadMappingType {
    return this.gamepad.mapping;
  }

  refresh(gamepad: Gamepad = this.gamepad): void {
    this.gamepad = gamepad;
    super.update(gamepad.buttons, gamepad.axes);
  }
}
