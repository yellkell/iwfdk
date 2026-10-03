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
 * IWFDK Chromium patch (`platform/chromium/patches/0004-*`). Gamepad indices
 * follow that patch's fixed layout:
 *
 * | index | left        | right  |
 * |-------|-------------|--------|
 * | 0     | trigger     | trigger |
 * | 1     | squeeze     | squeeze |
 * | 2     | (touchpad placeholder) | (placeholder) |
 * | 3     | thumbstick  | thumbstick |
 * | 4     | D-pad up    | A      |
 * | 5     | D-pad down  | B      |
 * | 6     | D-pad left  | X      |
 * | 7     | D-pad right | Y      |
 * | 8     | shoulder    | shoulder |
 * | 9     | view        | menu   |
 *
 * Axes: 0/1 touchpad placeholder, 2/3 thumbstick.
 *
 * There is no Frame controller model yet, so the visual reuses the generic
 * trigger/squeeze/thumbstick model; Frame-only buttons have no visual
 * response.
 */
export const VALVE_FRAME_PROFILE_ID = 'valve-frame';

/** Gamepad button indices of the valve-frame layout. */
export const ValveFrameGamepadIndex = {
  Trigger: 0,
  Squeeze: 1,
  Thumbstick: 3,
  /** Right: A. Left: D-pad up. */
  Slot4: 4,
  /** Right: B. Left: D-pad down. */
  Slot5: 5,
  /** Right: X. Left: D-pad left. */
  Slot6: 6,
  /** Right: Y. Left: D-pad right. */
  Slot7: 7,
  Shoulder: 8,
  /** Right: menu. Left: view. */
  Slot9: 9,
  ThumbstickXAxis: 2,
  ThumbstickYAxis: 3,
} as const;

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
      shoulder: button(ValveFrameGamepadIndex.Shoulder, 'shoulder'),
      ...buttons,
    },
    gamepadMapping: 'xr-standard',
    rootNodeName: `generic-trigger-squeeze-thumbstick-${handedness}`,
    assetPath: `${GENERIC_MODEL_BASE}/${handedness}.glb`,
  };
}

export const VALVE_FRAME_PROFILE: InputProfile = {
  profileId: VALVE_FRAME_PROFILE_ID,
  fallbackProfileIds: ['generic-trigger-squeeze-thumbstick'],
  layouts: {
    left: layout('left', {
      'dpad-up': button(ValveFrameGamepadIndex.Slot4, 'dpad_up'),
      'dpad-down': button(ValveFrameGamepadIndex.Slot5, 'dpad_down'),
      'dpad-left': button(ValveFrameGamepadIndex.Slot6, 'dpad_left'),
      'dpad-right': button(ValveFrameGamepadIndex.Slot7, 'dpad_right'),
      view: button(ValveFrameGamepadIndex.Slot9, 'view'),
    }),
    right: layout('right', {
      'a-button': button(ValveFrameGamepadIndex.Slot4, 'a_button'),
      'b-button': button(ValveFrameGamepadIndex.Slot5, 'b_button'),
      'x-button': button(ValveFrameGamepadIndex.Slot6, 'x_button'),
      'y-button': button(ValveFrameGamepadIndex.Slot7, 'y_button'),
      menu: button(ValveFrameGamepadIndex.Slot9, 'menu'),
    }),
  },
};
