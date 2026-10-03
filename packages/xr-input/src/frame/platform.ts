/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Whether the page runs in a browser on a Steam Frame (ARM64 SteamOS).
 *
 * Used when the browser does not report the `valve-frame` profile: without
 * the IWFDK Chromium patch, SteamVR presents the Frame controllers as
 * emulated Touch controllers, and this is how IWFDK still knows they are
 * Frame controllers. [verify] the user agent of the Frame browser; no other
 * WebXR headset browser reports ARM64 Linux.
 */
export function isSteamFrameBrowser(
  userAgent: string = globalThis.navigator?.userAgent ?? '',
): boolean {
  return /Linux (aarch64|arm64)/i.test(userAgent);
}

/** Profile ids SteamVR's Touch emulation of the Frame controllers reports. */
export const FRAME_EMULATION_PROFILE_IDS: readonly string[] = ['oculus-touch'];
