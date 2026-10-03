/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  InputComponentConfig,
  InputLayout,
  InputProfile,
} from '../input-profiles.js';

/**
 * WebXR input profile for the Valve Steam Frame controllers.
 *
 * Browsers report it for the OpenXR profile
 * `/interaction_profiles/valve/frame_controller_valve` once they carry the
 * IWFDK Chromium patches (`platform/chromium/patches/0004-*` and `0006-*`),
 * as `["valve-frame", "oculus-touch-v3", "oculus-touch",
 * "generic-trigger-squeeze-thumbstick"]`. Gamepad indices follow the
 * patches' fixed layout, whose slots 0-6 match Meta Touch
 * (`oculus-touch-v3`) so pages written for Quest controllers work unchanged;
 * the Frame-only controls follow from slot 7:
 *
 * | index | left                        | right                   |
 * | ----- | --------------------------- | ----------------------- |
 * | 0     | trigger                     | trigger                 |
 * | 1     | squeeze                     | squeeze                 |
 * | 2     | (touchpad placeholder)      | (touchpad placeholder)  |
 * | 3     | thumbstick                  | thumbstick              |
 * | 4     | X (mirrored from the right) | A                       |
 * | 5     | Y (mirrored from the right) | B                       |
 * | 6     | (thumbrest placeholder)     | (thumbrest placeholder) |
 * | 7     | D-pad up                    | X                       |
 * | 8     | D-pad down                  | Y                       |
 * | 9     | D-pad left                  | shoulder                |
 * | 10    | D-pad right                 | menu                    |
 * | 11    | shoulder                    |                         |
 * | 12    | view                        |                         |
 *
 * The Frame has X/Y on the right controller, where Touch has them on the
 * left, so the browser mirrors the right controller's X/Y into the left
 * gamepad's slots 4 and 5: pressing X reads as both right `x-button` (7) and
 * left `x-button` (4).
 *
 * Axes: 0/1 touchpad placeholder, 2/3 thumbstick.
 *
 * Without extracted models (see `loadFrameControllerModels`) the visual
 * reuses the generic trigger/squeeze/thumbstick model; Frame-only buttons
 * have no visual response.
 */
export const VALVE_FRAME_PROFILE_ID = 'valve-frame';

/** Gamepad button indices of the valve-frame layout. */
export const ValveFrameGamepadIndex = {
  Trigger: 0,
  Squeeze: 1,
  Thumbstick: 3,
  /** Right: A (Touch A). */
  A: 4,
  /** Right: B (Touch B). */
  B: 5,
  /** Left: the right controller's X, mirrored into Touch's left X slot. */
  MirroredX: 4,
  /** Left: the right controller's Y, mirrored into Touch's left Y slot. */
  MirroredY: 5,
  /** Right: X. */
  X: 7,
  /** Right: Y. */
  Y: 8,
  RightShoulder: 9,
  /** Right: menu. */
  Menu: 10,
  /** Left: D-pad up. */
  DpadUp: 7,
  /** Left: D-pad down. */
  DpadDown: 8,
  /** Left: D-pad left. */
  DpadLeft: 9,
  /** Left: D-pad right. */
  DpadRight: 10,
  LeftShoulder: 11,
  /** Left: view. */
  View: 12,
  ThumbstickXAxis: 2,
  ThumbstickYAxis: 3,
} as const;

/** Gamepad button count per hand (`gamepad.buttons.length`). */
export const ValveFrameButtonCount = { left: 13, right: 11 } as const;

const GENERIC_MODEL_BASE =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-trigger-squeeze-thumbstick';

function animated(
  rootNodeName: string,
  property: 'button' | 'xAxis' | 'yAxis',
  suffix = '',
) {
  const name = `${rootNodeName}${suffix}_pressed`;
  return {
    [name]: {
      componentProperty: property,
      states: ['default', 'touched', 'pressed'],
      valueNodeProperty: 'transform',
      valueNodeName: `${name}_value`,
      minNodeName: `${name}_min`,
      maxNodeName: `${name}_max`,
    },
  } as InputComponentConfig['visualResponses'];
}

function button(index: number, rootNodeName: string): InputComponentConfig {
  return {
    type: 'button',
    gamepadIndices: { button: index },
    rootNodeName,
    visualResponses: {},
  };
}

function layout(
  handedness: 'left' | 'right',
  buttons: Record<string, InputComponentConfig>,
): InputLayout {
  return {
    selectComponentId: 'xr-standard-trigger',
    components: {
      'xr-standard-trigger': {
        type: 'trigger',
        gamepadIndices: { button: ValveFrameGamepadIndex.Trigger },
        rootNodeName: 'xr_standard_trigger',
        visualResponses: animated('xr_standard_trigger', 'button'),
      },
      'xr-standard-squeeze': {
        type: 'squeeze',
        gamepadIndices: { button: ValveFrameGamepadIndex.Squeeze },
        rootNodeName: 'xr_standard_squeeze',
        visualResponses: animated('xr_standard_squeeze', 'button'),
      },
      'xr-standard-thumbstick': {
        type: 'thumbstick',
        gamepadIndices: {
          button: ValveFrameGamepadIndex.Thumbstick,
          xAxis: ValveFrameGamepadIndex.ThumbstickXAxis,
          yAxis: ValveFrameGamepadIndex.ThumbstickYAxis,
        },
        rootNodeName: 'xr_standard_thumbstick',
        visualResponses: {
          ...animated('xr_standard_thumbstick', 'button'),
          ...animated('xr_standard_thumbstick', 'xAxis', '_xaxis'),
          ...animated('xr_standard_thumbstick', 'yAxis', '_yaxis'),
        },
      },
      ...buttons,
    },
    gamepadMapping: 'xr-standard',
    rootNodeName: `generic-trigger-squeeze-thumbstick-${handedness}`,
    assetPath: `${GENERIC_MODEL_BASE}/${handedness}.glb`,
  };
}

export const VALVE_FRAME_PROFILE: InputProfile = {
  profileId: VALVE_FRAME_PROFILE_ID,
  fallbackProfileIds: [
    'oculus-touch-v3',
    'oculus-touch',
    'generic-trigger-squeeze-thumbstick',
  ],
  layouts: {
    left: layout('left', {
      'x-button': button(ValveFrameGamepadIndex.MirroredX, 'x_button'),
      'y-button': button(ValveFrameGamepadIndex.MirroredY, 'y_button'),
      'dpad-up': button(ValveFrameGamepadIndex.DpadUp, 'dpad_up'),
      'dpad-down': button(ValveFrameGamepadIndex.DpadDown, 'dpad_down'),
      'dpad-left': button(ValveFrameGamepadIndex.DpadLeft, 'dpad_left'),
      'dpad-right': button(ValveFrameGamepadIndex.DpadRight, 'dpad_right'),
      shoulder: button(ValveFrameGamepadIndex.LeftShoulder, 'shoulder'),
      view: button(ValveFrameGamepadIndex.View, 'view'),
    }),
    right: layout('right', {
      'a-button': button(ValveFrameGamepadIndex.A, 'a_button'),
      'b-button': button(ValveFrameGamepadIndex.B, 'b_button'),
      'x-button': button(ValveFrameGamepadIndex.X, 'x_button'),
      'y-button': button(ValveFrameGamepadIndex.Y, 'y_button'),
      shoulder: button(ValveFrameGamepadIndex.RightShoulder, 'shoulder'),
      menu: button(ValveFrameGamepadIndex.Menu, 'menu'),
    }),
  },
};
