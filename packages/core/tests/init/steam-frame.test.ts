/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resetSteamFrameRenderingForTests,
  shouldFinishXRFrame,
  withoutProjectionLayers,
} from '../../src/init/steam-frame.js';
import { adoptXRSession, buildSessionInit } from '../../src/init/xr.js';

// xr.ts -> runtime barrel -> xr-input cursor-visual.ts touches `document` at
// module load; provide a minimal canvas stub before importing.
vi.hoisted(() => {
  (globalThis as any).document = {
    createElement: () => ({
      getContext: () => ({
        arc: () => {},
        beginPath: () => {},
        clearRect: () => {},
        fill: () => {},
        fillStyle: '',
        lineWidth: 0,
        stroke: () => {},
        strokeStyle: '',
      }),
      height: 0,
      width: 0,
    }),
  };
});

// Chromium's reduced UA hides the Frame's CPU; IWFDK also reads
// userAgentData, but the UA fallback is enough to stand in for a Frame here.
const FRAME_UA = 'Mozilla/5.0 (X11; Linux aarch64) Chrome/157.0.0.0';
const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/38.0 Chrome/132.0.0.0 VR';

function browser(userAgent: string) {
  vi.stubGlobal('navigator', { userAgent });
}

class FakeXRWebGLBinding {
  createProjectionLayer() {
    return {};
  }
}

function stubBinding() {
  vi.stubGlobal('XRWebGLBinding', FakeXRWebGLBinding);
  return FakeXRWebGLBinding.prototype;
}

function session(...profiles: string[][]) {
  return {
    inputSources: profiles.map((p) => ({ profiles: p })),
  } as unknown as XRSession;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetSteamFrameRenderingForTests();
});

describe('WebXR Layers on a Steam Frame browser', () => {
  it('does not offer layers on a Frame, keeping the other defaults', () => {
    browser(FRAME_UA);
    const init = buildSessionInit({ features: { layers: true } });

    expect(init.optionalFeatures).not.toContain('layers');
    expect(init.optionalFeatures).toEqual(
      expect.arrayContaining(['local-floor', 'bounded-floor']),
    );
  });

  it('still requests layers on a Frame when the app requires them', () => {
    browser(FRAME_UA);
    const init = buildSessionInit({ features: { layers: { required: true } } });

    expect(init.requiredFeatures).toContain('layers');
  });

  it('offers layers everywhere else, Quest Browser included', () => {
    browser(QUEST_UA);
    expect(buildSessionInit({}).optionalFeatures).toContain('layers');
  });

  it('hides createProjectionLayer from three.js while the session is set up', async () => {
    browser(FRAME_UA);
    const proto = stubBinding();
    let seen: boolean | undefined;

    await withoutProjectionLayers(async () => {
      seen = 'createProjectionLayer' in proto;
    });

    expect(seen).toBe(false);
    expect(typeof proto.createProjectionLayer).toBe('function');
  });

  it('restores createProjectionLayer when setup fails', async () => {
    browser(FRAME_UA);
    const proto = stubBinding();

    await expect(
      withoutProjectionLayers(async () => {
        throw new Error('setSession failed');
      }),
    ).rejects.toThrow('setSession failed');

    expect('createProjectionLayer' in proto).toBe(true);
  });

  it('leaves projection layers alone elsewhere', async () => {
    browser(QUEST_UA);
    const proto = stubBinding();
    let seen: boolean | undefined;

    await withoutProjectionLayers(async () => {
      seen = 'createProjectionLayer' in proto;
    });

    expect(seen).toBe(true);
  });

  it('adopts a session on a Frame without projection layers', async () => {
    browser(FRAME_UA);
    const proto = stubBinding();
    let seen: boolean | undefined;
    const xrSession = new EventTarget() as EventTarget &
      Record<string, unknown>;
    xrSession.end = vi.fn().mockResolvedValue(undefined);
    xrSession.requestReferenceSpace = vi.fn().mockResolvedValue({});
    const world = {
      camera: {},
      renderer: {
        xr: {
          setReferenceSpaceType: () => {},
          setSession: vi.fn(async () => {
            seen = 'createProjectionLayer' in proto;
          }),
        },
      },
      session: undefined,
    } as any;

    await expect(
      adoptXRSession(world, xrSession as unknown as XRSession, {
        restoreCameraOnExit: false,
      }),
    ).resolves.toBe(true);

    expect(seen).toBe(false);
    expect('createProjectionLayer' in proto).toBe(true);
  });
});

describe('finishing XR frames (right-eye workaround)', () => {
  it('finishes frames on a Frame browser that reports Touch controllers', () => {
    browser(FRAME_UA);
    expect(shouldFinishXRFrame('auto', session(['oculus-touch']))).toBe(true);
    expect(shouldFinishXRFrame('auto', session())).toBe(true);
  });

  it('stops once Chromium XR is recognised by its valve-frame controllers', () => {
    browser(FRAME_UA);
    const chromiumXR = session(['valve-frame', 'oculus-touch-v3']);

    expect(shouldFinishXRFrame('auto', chromiumXR)).toBe(false);
    // Remembered when the controllers are put down for hand tracking.
    expect(shouldFinishXRFrame('auto', session(['generic-hand']))).toBe(false);
  });

  it('never finishes outside XR or on other browsers unless forced', () => {
    browser(QUEST_UA);
    expect(shouldFinishXRFrame('auto', session(['oculus-touch-v3']))).toBe(
      false,
    );
    expect(shouldFinishXRFrame(true, session())).toBe(true);
    expect(shouldFinishXRFrame(true, undefined)).toBe(false);

    browser(FRAME_UA);
    expect(shouldFinishXRFrame(false, session(['oculus-touch']))).toBe(false);
  });
});
