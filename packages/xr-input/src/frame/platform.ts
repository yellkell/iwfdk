/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

const ARM_LINUX_USER_AGENT = /Linux (aarch64|arm64)/i;

/**
 * Other headsets' browsers run Chromium on ARM too and may present as Linux
 * (Meta Quest Browser's user agent says "X11; Linux x86_64; Quest"). IWFDK
 * changes how it renders on a Steam Frame, so these must never match.
 */
const OTHER_HEADSET_BROWSER = /OculusBrowser|Quest|Pico|Android|Wolvic/i;

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
        armLinux =
          platform === 'Linux' &&
          architecture === 'arm' &&
          !OTHER_HEADSET_BROWSER.test(globalThis.navigator?.userAgent ?? '');
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
 * `@iwsdk/core` also uses it to avoid the Frame browsers' rendering
 * problems (see FRAME.md, "Making a WebXR app great on the Steam Frame").
 *
 * With `userAgent` given, only that string is checked. Without it, the
 * result of {@link detectSteamFrameBrowser} is used once it has resolved
 * (it starts when this module loads), with the user agent as a fallback.
 */
export function isSteamFrameBrowser(userAgent?: string): boolean {
  if (userAgent !== undefined) {
    return isArmLinuxUserAgent(userAgent);
  }
  return (
    armLinux === true ||
    isArmLinuxUserAgent(globalThis.navigator?.userAgent ?? '')
  );
}

function isArmLinuxUserAgent(userAgent: string): boolean {
  return (
    ARM_LINUX_USER_AGENT.test(userAgent) &&
    !OTHER_HEADSET_BROWSER.test(userAgent)
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
