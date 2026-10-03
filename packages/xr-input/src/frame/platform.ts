/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const ARM_LINUX_USER_AGENT = /Linux (aarch64|arm64)/i;

interface UserAgentDataValues {
  platform?: string;
  architecture?: string;
}

interface NavigatorUserAgentData {
  getHighEntropyValues(hints: string[]): Promise<UserAgentDataValues>;
}

/** Result of the CPU check, once `navigator.userAgentData` has answered. */
let armLinux: boolean | undefined;
let detection: Promise<boolean> | undefined;

/**
 * Asks the browser for its real platform and CPU architecture. Chromium's
 * reduced user agent says "Linux x86_64" on every Linux CPU, so the Frame
 * browser (arm64 Chromium; verified 2026-10-03, Chromium 157) can't be told
 * apart by `navigator.userAgent`; `userAgentData` reports platform "Linux",
 * architecture "arm". Resolves (and caches) whether this is ARM Linux, or
 * falls back to the user agent where `userAgentData` is unavailable.
 */
export function detectSteamFrameBrowser(): Promise<boolean> {
  detection ??= (async () => {
    const uaData = (
      globalThis.navigator as
        | { userAgentData?: NavigatorUserAgentData }
        | undefined
    )?.userAgentData;
    try {
      if (uaData) {
        const { platform, architecture } = await uaData.getHighEntropyValues([
          'platform',
          'architecture',
        ]);
        armLinux = platform === 'Linux' && architecture === 'arm';
        return (
          armLinux || isSteamFrameBrowser(globalThis.navigator?.userAgent ?? '')
        );
      }
    } catch {
      // Fall through to the user agent.
    }
    return isSteamFrameBrowser(globalThis.navigator?.userAgent ?? '');
  })();
  return detection;
}

/**
 * Whether the page runs in a browser on a Steam Frame (ARM64 SteamOS).
 *
 * Used when the browser does not report the `valve-frame` profile: without
 * the IWFDK Chromium patch, SteamVR presents the Frame controllers as
 * emulated Touch controllers, and this is how IWFDK still knows they are
 * Frame controllers. No other WebXR headset browser runs on ARM64 Linux.
 *
 * With `userAgent` given, only that string is checked. Without it, the
 * result of {@link detectSteamFrameBrowser} is used once it has resolved
 * (it starts when this module loads), with the user agent as a fallback.
 */
export function isSteamFrameBrowser(userAgent?: string): boolean {
  if (userAgent !== undefined) {
    return ARM_LINUX_USER_AGENT.test(userAgent);
  }
  return (
    armLinux === true ||
    ARM_LINUX_USER_AGENT.test(globalThis.navigator?.userAgent ?? '')
  );
}

/** Profile ids SteamVR's Touch emulation of the Frame controllers reports. */
export const FRAME_EMULATION_PROFILE_IDS: readonly string[] = ['oculus-touch'];

// Start the CPU check early so the synchronous answer is ready by the time
// an XR session starts.
void detectSteamFrameBrowser();

/** Clears the cached detection (tests). */
export function resetSteamFrameDetectionForTests(): void {
  armLinux = undefined;
  detection = undefined;
}
