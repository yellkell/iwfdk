/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { XRDevice } from 'iwer';

type Hand = 'left' | 'right';
type Controller = NonNullable<XRDevice['controllers'][Hand]>;

interface ButtonState {
  index?: number;
  name?: string;
  value: number;
  touched?: boolean;
}

interface GamepadStateParams {
  device?: string;
  buttons?: ButtonState[];
  axes?: unknown[];
}

interface GamepadStateResult {
  buttons: {
    index: number;
    name: string;
    value: number;
    touched: boolean;
    pressed: boolean;
  }[];
}

interface GamepadRemote {
  executeGetGamepadState(params: GamepadStateParams): GamepadStateResult;
  executeSetGamepadState(params: GamepadStateParams): {
    buttonsSet: number;
    axesSet: number;
  };
}

/**
 * IWER's `xr_get_gamepad_state` / `xr_set_gamepad_state` know six Touch
 * buttons by index: 0 trigger, 1 squeeze, 2 thumbstick, 3 A/X, 4 B/Y,
 * 5 thumbrest.
 */
function touchButtonIds(hand: Hand): string[] {
  return [
    'trigger',
    'squeeze',
    'thumbstick',
    hand === 'left' ? 'x-button' : 'a-button',
    hand === 'left' ? 'y-button' : 'b-button',
    'thumbrest',
  ];
}

/** The tool's name for a button id: `x-button` is `x`, `dpad-up` stays. */
function toolName(id: string): string {
  return id.replace(/-button$/, '');
}

/**
 * Every button the tools can address on `controller`, by tool index: IWER's
 * six Touch buttons first, so their indices never change, then the
 * controller's other buttons in gamepad order (on a Steam Frame: X, Y,
 * shoulder and menu on the right; the D-pad, shoulder and view on the left).
 */
export function gamepadToolButtonIds(controller: Controller, hand: Hand) {
  const touch = touchButtonIds(hand);
  const others = controller.gamepadConfig.buttons
    .filter((button) => button != null)
    .map((button) => button.id)
    .filter((id) => !touch.includes(id));
  return [...touch, ...others];
}

/**
 * Extends the device's gamepad tools to every button of the emulated
 * controller: `xr_get_gamepad_state` also lists the buttons after index 5,
 * and `xr_set_gamepad_state` takes those indices or a button `name` (as
 * `xr_get_gamepad_state` reports it, e.g. `dpad-up`, `menu`, `x`).
 */
export function extendGamepadTools(device: XRDevice): void {
  const remote = device.remote as unknown as GamepadRemote;
  const get = remote.executeGetGamepadState.bind(remote);
  const set = remote.executeSetGamepadState.bind(remote);

  const target = (params: GamepadStateParams) => {
    const hand: Hand = params.device === 'controller-left' ? 'left' : 'right';
    const controller = device.controllers[hand];
    return controller
      ? { hand, controller, ids: gamepadToolButtonIds(controller, hand) }
      : undefined;
  };

  remote.executeGetGamepadState = (params) => {
    const result = get(params);
    const resolved = target(params);
    if (!resolved) {
      return result;
    }
    const { controller, ids } = resolved;
    for (let index = result.buttons.length; index < ids.length; index++) {
      const value = controller.getButtonValue(ids[index]);
      result.buttons.push({
        index,
        name: toolName(ids[index]),
        value,
        touched: controller.getButtonTouched(ids[index]),
        pressed: value > 0.5,
      });
    }
    return result;
  };

  remote.executeSetGamepadState = (params) => {
    const resolved = target(params);
    if (!resolved || !params.buttons) {
      return set(params);
    }
    const { hand, controller, ids } = resolved;
    const touchCount = touchButtonIds(hand).length;
    const forIWER: ButtonState[] = [];
    const extra: { id: string; state: ButtonState }[] = [];
    for (const state of params.buttons) {
      let index = state.index;
      if (state.name !== undefined) {
        index = ids.findIndex(
          (id) => id === state.name || toolName(id) === state.name,
        );
        if (index < 0) {
          throw new Error(
            `${params.device} has no button "${state.name}". Buttons: ${ids
              .map(toolName)
              .join(', ')}`,
          );
        }
      }
      if (index !== undefined && index >= touchCount && index < ids.length) {
        extra.push({ id: ids[index], state });
      } else {
        forIWER.push({ ...state, index: index! });
      }
    }
    const result = set({ ...params, buttons: forIWER });
    for (const { id, state } of extra) {
      if (!Number.isFinite(state.value)) {
        continue;
      }
      controller.updateButtonValue(id, Math.min(1, Math.max(0, state.value)));
      if (state.touched !== undefined) {
        controller.updateButtonTouch(id, state.touched);
      }
      result.buttonsSet++;
    }
    return result;
  };
}
