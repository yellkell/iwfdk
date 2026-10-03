/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRInputManager } from '@iwsdk/xr-input';
import { WebXRManager } from '../runtime/index.js';
import { InputActionManager } from './input-actions.js';
import { StatefulBrowserGamepad } from './stateful-browser-gamepad.js';
import { StatefulKeyboard } from './stateful-keyboard.js';

export type CanvasPointerEventsOption =
  | boolean
  | {
      enabled?: boolean;
      activeDuringXR?: boolean;
    };

export type NormalizedCanvasPointerEventsOptions = {
  enabled: boolean;
  activeDuringXR: boolean;
};

export type InputManagerOptions = {
  canvasPointerEvents?: CanvasPointerEventsOption;
};

export function normalizeCanvasPointerEventsOptions(
  option: CanvasPointerEventsOption | undefined,
): NormalizedCanvasPointerEventsOptions {
  if (typeof option === 'boolean') {
    return { enabled: option, activeDuringXR: false };
  }

  return {
    enabled: option?.enabled ?? true,
    activeDuringXR: option?.activeDuringXR ?? false,
  };
}

export class InputManager {
  public readonly xr: XRInputManager;
  public readonly keyboard: StatefulKeyboard;
  public readonly browserGamepads: Array<StatefulBrowserGamepad | undefined> =
    [];
  public readonly actions: InputActionManager;
  public readonly canvasPointerEvents: NormalizedCanvasPointerEventsOptions;

  constructor(xr: XRInputManager, options: InputManagerOptions = {}) {
    this.xr = xr;
    this.keyboard = new StatefulKeyboard();
    this.actions = new InputActionManager();
    this.canvasPointerEvents = normalizeCanvasPointerEventsOptions(
      options.canvasPointerEvents,
    );
  }

  /** @deprecated Use input.xr.gamepads instead. */
  get gamepads() {
    return this.xr.gamepads;
  }

  /** @deprecated Use input.xr.multiPointers instead. */
  get multiPointers() {
    return this.xr.multiPointers;
  }

  /** @deprecated Use input.xr.visualAdapters instead. */
  get visualAdapters() {
    return this.xr.visualAdapters;
  }

  /** @deprecated Use input.xr.isPrimary(...) instead. */
  isPrimary(...args: Parameters<XRInputManager['isPrimary']>) {
    return this.xr.isPrimary(...args);
  }

  /** @deprecated Use input.xr.getPrimaryInputSource(...) instead. */
  getPrimaryInputSource(
    ...args: Parameters<XRInputManager['getPrimaryInputSource']>
  ) {
    return this.xr.getPrimaryInputSource(...args);
  }

  update(xrManager: WebXRManager, delta: number, time: number): void {
    this.keyboard.update();
    this.updateBrowserGamepads();
    this.xr.update(xrManager, delta, time);
    this.actions.update({
      keyboard: this.keyboard,
      browserGamepads: this.browserGamepads,
      xr: this.xr,
    });
  }

  destroy(): void {
    this.keyboard.destroy();
  }

  private updateBrowserGamepads(): void {
    if (!navigator.getGamepads) {
      this.browserGamepads.length = 0;
      return;
    }

    const gamepads = navigator.getGamepads();
    this.browserGamepads.length = gamepads.length;
    for (let index = 0; index < gamepads.length; index++) {
      const gamepad = gamepads[index];
      if (!gamepad) {
        this.browserGamepads[index] = undefined;
        continue;
      }

      const state = this.browserGamepads[index];
      if (state) {
        state.refresh(gamepad);
      } else {
        const nextState = new StatefulBrowserGamepad(gamepad);
        nextState.refresh(gamepad);
        this.browserGamepads[index] = nextState;
      }
    }
  }
}
