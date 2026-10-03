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
 * - **valve-frame** (browser with the IWFDK Chromium patch): every control is
 *   physical, laid out as on the hardware: A/B/X/Y and menu on the right,
 *   D-pad and view on the left.
 * - **valve-index** (unpatched browser; SteamVR remaps the Frame onto the
 *   Index profile): A on the right; the left A stands in for X, as FramePlayer
 *   binds Index controllers. Chromium exposes no B, menu or view for Index, so
 *   those read released and the D-pad is emulated from the left stick.
 * - **Touch-style** (oculus-touch, meta-quest-touch-*, pico-4, ...): A/B on
 *   the right, X/Y and menu on the left.
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
  x: [
    ['right', InputComponent.X_Button],
    ['left', InputComponent.X_Button],
    ['left', InputComponent.A_Button],
  ],
  y: [
    ['right', InputComponent.Y_Button],
    ['left', InputComponent.Y_Button],
    ['left', InputComponent.B_Button],
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
