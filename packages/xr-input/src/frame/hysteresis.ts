/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** Digital button with edges, as FramePlayer's `fp-xr` `Button`. */
export class FrameButton {
  pressed = false;
  justPressed = false;
  justReleased = false;
  /** Capacitive touch (follows `pressed` where the hardware has none). */
  touched = false;

  update(pressed: boolean, touched: boolean): void {
    this.justPressed = pressed && !this.pressed;
    this.justReleased = !pressed && this.pressed;
    this.pressed = pressed;
    this.touched = touched || pressed;
  }

  reset(): void {
    this.update(false, false);
  }
}

/** Analog → digital with hysteresis (press at `on` or above, release at `off` or below). */
export function analogPress(
  was: boolean,
  value: number,
  on: number,
  off: number,
): boolean {
  return was ? value > off : value >= on;
}

/** `[up, down, left, right]`. */
export type DpadDirections = [boolean, boolean, boolean, boolean];

/**
 * Emulate a D-pad from a stick: only the dominant axis, with `threshold` on
 * its magnitude and hysteresis via `prev` (release at 70% of `threshold`).
 *
 * `x` is positive right and `y` positive **up**. WebXR gamepads report y
 * positive down, so negate it first.
 */
export function stickToDpad(
  x: number,
  y: number,
  prev: Readonly<DpadDirections>,
  threshold: number,
): DpadDirections {
  const release = threshold * 0.7;
  const horizontal = Math.abs(x) > Math.abs(y);
  const held = (i: number, value: number) =>
    prev[i] ? value > release : value >= threshold;
  return [
    !horizontal && held(0, y),
    !horizontal && held(1, -y),
    horizontal && held(2, -x),
    horizontal && held(3, x),
  ];
}
