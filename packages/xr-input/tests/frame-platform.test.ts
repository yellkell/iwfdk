/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectSteamFrameBrowser,
  isSteamFrameBrowser,
  resetSteamFrameDetectionForTests,
} from '../src/frame/platform.js';

// The Frame browser as seen on a real Steam Frame (Chromium 157, arm64):
// the reduced user agent says x86_64, userAgentData says Linux/arm.
const FRAME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

function stubNavigator(
  userAgent: string,
  uaData?: { platform: string; architecture: string },
) {
  vi.stubGlobal('navigator', {
    userAgent,
    userAgentData: uaData && {
      getHighEntropyValues: async () => uaData,
    },
  });
  resetSteamFrameDetectionForTests();
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSteamFrameDetectionForTests();
});

describe('Steam Frame browser detection', () => {
  it('recognises the Frame from userAgentData though the UA says x86_64', async () => {
    stubNavigator(FRAME_UA, { platform: 'Linux', architecture: 'arm' });
    expect(isSteamFrameBrowser()).toBe(false); // not answered yet
    await expect(detectSteamFrameBrowser()).resolves.toBe(true);
    expect(isSteamFrameBrowser()).toBe(true);
  });

  it('is false on an x86-64 Linux or an ARM non-Linux browser', async () => {
    stubNavigator(FRAME_UA, { platform: 'Linux', architecture: 'x86' });
    await expect(detectSteamFrameBrowser()).resolves.toBe(false);
    stubNavigator('Mozilla/5.0 (Macintosh)', {
      platform: 'macOS',
      architecture: 'arm',
    });
    await expect(detectSteamFrameBrowser()).resolves.toBe(false);
  });

  it('never matches another headset browser that reports ARM Linux', async () => {
    const quest =
      'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/38.0 Chrome/132.0.0.0 VR Safari/537.36';
    stubNavigator(quest, { platform: 'Linux', architecture: 'arm' });
    await expect(detectSteamFrameBrowser()).resolves.toBe(false);
    expect(isSteamFrameBrowser()).toBe(false);
    expect(isSteamFrameBrowser('Mozilla/5.0 (Linux; Android 12; arm64)')).toBe(
      false,
    );
    expect(isSteamFrameBrowser('X11; Linux aarch64; Pico 4')).toBe(false);
  });

  it('falls back to the user agent without userAgentData', async () => {
    stubNavigator('Mozilla/5.0 (X11; Linux aarch64)');
    await expect(detectSteamFrameBrowser()).resolves.toBe(true);
    expect(isSteamFrameBrowser()).toBe(true);
  });

  it('checks only the given user agent when one is passed', async () => {
    stubNavigator(FRAME_UA, { platform: 'Linux', architecture: 'arm' });
    await detectSteamFrameBrowser();
    expect(isSteamFrameBrowser('X11; Linux x86_64')).toBe(false);
    expect(isSteamFrameBrowser('X11; Linux aarch64')).toBe(true);
  });
});
