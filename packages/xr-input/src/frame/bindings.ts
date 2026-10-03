/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { InputComponent } from '../gamepad/stateful-gamepad.js';

/**
 * Where each Steam Frame control comes from, as an ordered list of
 * `(hand, component id)` candidates; the first component present in the
 * active input profile wins. This is the WebXR counterpart of FramePlayer's
 * OpenXR binding tiers (`fp-xr` `bindings.rs`):
 *
 * - **valve-frame** (browser with the IWFDK Chromium patches 0004 and 0006):
 *   every control is physical, laid out as on the hardware: A/B/X/Y and menu
 *   on the right (gamepad slots 4, 5, 7, 8 and 10), D-pad and view on the
 *   left (slots 7-10 and 12). The browser also mirrors the right X/Y into the
 *   left gamepad's Touch X/Y slots (4/5) for Quest-only pages; the right
 *   controller comes first below, so `FrameInput` reads the physical
 *   buttons. Shoulder buttons are per hand (`FrameControllerState.shoulder`;
 *   right slot 9, left slot 11).
 * - **Touch layout** (SteamVR's Touch emulation on a Frame whose browser
 *   lacks the patches, which reports `oculus-touch`; and Touch-style
 *   controllers elsewhere): A/B on the right, X/Y and menu on the left as the
 *   emulation exposes them; the D-pad is emulated from the left stick. Since
 *   patch 0006 the `valve-frame` gamepad also has Touch's A/B/X/Y slots, so
 *   code that only knows Touch component ids reads A/B/X/Y on the Frame too.
 */
export type FrameButtonId =
  | 'a'
  | 'b'
  | 'x'
  | 'y'
  | 'menu'
  | 'view'
  | 'dpadUp'
  | 'dpadDown'
  | 'dpadLeft'
  | 'dpadRight';

export type FrameHand = 'left' | 'right';

export type FrameComponentRef = readonly [FrameHand, string];

export const FRAME_BUTTON_IDS: readonly FrameButtonId[] = [
  'a',
  'b',
  'x',
  'y',
  'menu',
  'view',
  'dpadUp',
  'dpadDown',
  'dpadLeft',
  'dpadRight',
];

export const FRAME_BUTTON_SOURCES: Readonly<
  Record<FrameButtonId, readonly FrameComponentRef[]>
> = {
  a: [['right', InputComponent.A_Button]],
  b: [['right', InputComponent.B_Button]],
  // Right first: on valve-frame the left X/Y are the browser's mirror of the
  // right controller's; on Touch layouts only the left ones exist.
  x: [
    ['right', InputComponent.X_Button],
    ['left', InputComponent.X_Button],
  ],
  y: [
    ['right', InputComponent.Y_Button],
    ['left', InputComponent.Y_Button],
  ],
  menu: [
    ['right', InputComponent.Menu],
    ['left', InputComponent.Menu],
  ],
  view: [['left', InputComponent.View]],
  dpadUp: [['left', InputComponent.DpadUp]],
  dpadDown: [['left', InputComponent.DpadDown]],
  dpadLeft: [['left', InputComponent.DpadLeft]],
  dpadRight: [['left', InputComponent.DpadRight]],
};

/** Minimal view of a component-mapped gamepad (`StatefulGamepad` fits). */
export interface FrameGamepadLike {
  readonly buttonMapping: ReadonlyMap<string, number>;
  getButtonPressed(id: string): boolean;
  getButtonTouched(id: string): boolean;
  getButtonValue(id: string): number;
  getAxesValues(id: string): { x: number; y: number } | undefined;
  readonly inputSource?: XRInputSource;
  readonly gamepad?: Gamepad;
}

export type FrameGamepads = Partial<
  Record<FrameHand, FrameGamepadLike | undefined>
>;

/** First candidate component present on the current gamepads. */
export function resolveFrameButton(
  id: FrameButtonId,
  gamepads: FrameGamepads,
): FrameComponentRef | undefined {
  return FRAME_BUTTON_SOURCES[id].find(([hand, component]) =>
    gamepads[hand]?.buttonMapping.has(component),
  );
}
