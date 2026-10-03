/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { InputConfig } from '../visual/adapter/base-visual-adapter.js';
import { StatefulButtonAxesDevice } from './stateful-button-axes-device.js';
export { AxesState } from './stateful-button-axes-device.js';

export enum InputComponent {
  Trigger = 'xr-standard-trigger',
  Squeeze = 'xr-standard-squeeze',
  Touchpad = 'xr-standard-touchpad',
  Thumbstick = 'xr-standard-thumbstick',
  A_Button = 'a-button',
  B_Button = 'b-button',
  X_Button = 'x-button',
  Y_Button = 'y-button',
  Thumbrest = 'thumbrest',
  Menu = 'menu',
}

export class StatefulGamepad extends StatefulButtonAxesDevice {
  public readonly handedness: XRHandedness;
  public readonly gamepad: Gamepad;
  public readonly inputSource: XRInputSource;

  constructor({ inputSource, layout }: InputConfig) {
    super(layout, inputSource.gamepad!.buttons.length);
    this.handedness = inputSource.handedness;
    this.gamepad = inputSource.gamepad!;
    this.inputSource = inputSource;
  }

  update() {
    super.update(this.gamepad.buttons, this.gamepad.axes);
  }
}
