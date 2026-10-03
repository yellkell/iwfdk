/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROFILES_PATH,
  fetchProfile,
  fetchProfileSync,
  getRegisteredInputProfile,
  loadInputProfile,
  registerInputProfile,
  unregisterInputProfile,
  type InputProfile,
} from '../src/gamepad/input-profiles.js';
import {
  VALVE_FRAME_PROFILE,
  ValveFrameGamepadIndex,
} from '../src/gamepad/profiles/valve-frame.js';
import { InputComponent } from '../src/gamepad/stateful-gamepad.js';

function source(
  profiles: string[],
  handedness: XRHandedness = 'right',
): XRInputSource {
  return { profiles, handedness } as unknown as XRInputSource;
}

const CUSTOM: InputProfile = {
  profileId: 'test-custom',
  fallbackProfileIds: [],
  layouts: {
    right: {
      selectComponentId: 'xr-standard-trigger',
      components: {
        'xr-standard-trigger': {
          type: 'trigger',
          gamepadIndices: { button: 0 },
          rootNodeName: 'trigger',
          visualResponses: {},
        },
      },
      gamepadMapping: 'xr-standard',
      rootNodeName: 'root',
      assetPath: 'right.glb',
    },
  },
};

describe('input profile registry', () => {
  afterEach(() => {
    unregisterInputProfile(CUSTOM.profileId);
  });

  it('resolves bundled profiles as before', () => {
    const profile = fetchProfileSync(
      source(['oculus-touch-v3', 'generic-trigger-squeeze-thumbstick']),
    );
    expect(profile.profileId).toBe('oculus-touch-v3');
    const config = loadInputProfile(source(['oculus-touch-v3']));
    expect(config.assetPath).toBe(
      `${DEFAULT_PROFILES_PATH}/oculus-touch-v3/right.glb`,
    );
  });

  it('falls back to generic-trigger for unknown profiles', () => {
    expect(fetchProfileSync(source(['no-such-profile'])).profileId).toBe(
      'generic-trigger',
    );
  });

  it('resolves registered profiles with their asset base path', () => {
    registerInputProfile(CUSTOM, { assetBasePath: '/models/custom/' });
    expect(getRegisteredInputProfile('test-custom')).toBe(CUSTOM);
    const config = loadInputProfile(source(['test-custom', 'generic-button']));
    expect(config.resolvedProfileId).toBe('test-custom');
    expect(config.assetPath).toBe('/models/custom/right.glb');
  });

  it('walks input source profiles in order', () => {
    registerInputProfile(CUSTOM);
    expect(
      fetchProfileSync(source(['oculus-touch', 'test-custom'])).profileId,
    ).toBe('oculus-touch');
    expect(
      fetchProfileSync(source(['no-such-profile', 'test-custom'])).profileId,
    ).toBe('test-custom');
  });

  it('defaults relative registered assets to the CDN profile folder', () => {
    registerInputProfile(CUSTOM);
    expect(loadInputProfile(source(['test-custom'])).assetPath).toBe(
      `${DEFAULT_PROFILES_PATH}/test-custom/right.glb`,
    );
  });
});

describe('fetchProfile (CDN)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    unregisterInputProfile(CUSTOM.profileId);
  });

  function stubFetch() {
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      statusText: 'OK',
      json: async () =>
        url.endsWith('profilesList.json')
          ? { 'oculus-touch': { path: 'oculus-touch/profile.json' } }
          : { profileId: 'oculus-touch', fallbackProfileIds: [], layouts: {} },
    }));
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  it('returns a leading registered profile without fetching', async () => {
    const fetch = stubFetch();
    const profile = await fetchProfile(source(['valve-frame']), {});
    expect(profile.profileId).toBe('valve-frame');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('walks profiles in order across registered and CDN entries', async () => {
    stubFetch();
    registerInputProfile(CUSTOM);
    expect(
      (await fetchProfile(source(['oculus-touch', 'test-custom']), {}))
        .profileId,
    ).toBe('oculus-touch');
    expect(
      (await fetchProfile(source(['no-such-profile', 'test-custom']), {}))
        .profileId,
    ).toBe('test-custom');
  });
});

describe('valve-frame profile', () => {
  it('is registered by default', () => {
    expect(getRegisteredInputProfile('valve-frame')).toBe(VALVE_FRAME_PROFILE);
    const config = loadInputProfile(
      source(['valve-frame', 'generic-trigger-squeeze-thumbstick'], 'left'),
    );
    expect(config.resolvedProfileId).toBe('valve-frame');
    expect(config.assetPath).toMatch(
      /generic-trigger-squeeze-thumbstick\/left\.glb$/,
    );
  });

  it('matches the Chromium patch slot layout', () => {
    const index = (hand: 'left' | 'right', id: string) =>
      VALVE_FRAME_PROFILE.layouts[hand]!.components[id]?.gamepadIndices.button;
    // platform/chromium/patches/0004: kValveFrame{Left,Right}Slots.
    expect(
      [
        InputComponent.A_Button,
        InputComponent.B_Button,
        InputComponent.X_Button,
        InputComponent.Y_Button,
        InputComponent.Bumper,
        InputComponent.Menu,
      ].map((id) => index('right', id)),
    ).toEqual([4, 5, 6, 7, 8, 9]);
    expect(
      [
        InputComponent.DpadUp,
        InputComponent.DpadDown,
        InputComponent.DpadLeft,
        InputComponent.DpadRight,
        InputComponent.Bumper,
        InputComponent.View,
      ].map((id) => index('left', id)),
    ).toEqual([4, 5, 6, 7, 8, 9]);
    for (const hand of ['left', 'right'] as const) {
      const components = VALVE_FRAME_PROFILE.layouts[hand]!.components;
      expect(components[InputComponent.Trigger].gamepadIndices.button).toBe(0);
      expect(components[InputComponent.Squeeze].gamepadIndices.button).toBe(1);
      expect(components[InputComponent.Thumbstick].gamepadIndices).toEqual({
        button: 3,
        xAxis: ValveFrameGamepadIndex.ThumbstickXAxis,
        yAxis: ValveFrameGamepadIndex.ThumbstickYAxis,
      });
    }
  });

  it('keeps every gamepad index unique per hand', () => {
    for (const hand of ['left', 'right'] as const) {
      const buttons = Object.values(
        VALVE_FRAME_PROFILE.layouts[hand]!.components,
      ).map((c) => c.gamepadIndices.button);
      expect(new Set(buttons).size).toBe(buttons.length);
    }
  });
});
