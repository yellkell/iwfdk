/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  FrameControls,
  LAYOUTS,
  frameLayout,
  frameSessionInit,
  isSteamFrame,
  prepareFrameRendering,
  pulse,
  resetDetectionForTests,
} from '../steam-frame.js';

const FRAME_UA =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126.0 VR Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0 Safari/537.36';

function source(handedness, profiles, count) {
  return {
    handedness,
    profiles,
    gamepad: {
      buttons: Array.from({ length: count }, () => ({
        pressed: false,
        touched: false,
        value: 0,
      })),
      axes: [0, 0, 0, 0],
    },
  };
}
const press = (s, i, on = true) =>
  Object.assign(s.gamepad.buttons[i], { pressed: on, touched: on, value: +on });
function frameSession() {
  const profiles = ['valve-frame', 'oculus-touch-v3', 'oculus-touch'];
  return {
    inputSources: [source('left', profiles, 13), source('right', profiles, 11)],
  };
}
function touchSession() {
  const profiles = ['oculus-touch', 'generic-trigger-squeeze-thumbstick'];
  return {
    inputSources: [source('left', profiles, 7), source('right', profiles, 7)],
  };
}

describe('isSteamFrame', () => {
  beforeEach(resetDetectionForTests);
  it('matches ARM64 Linux and never another headset', () => {
    assert.equal(isSteamFrame(FRAME_UA), true);
    assert.equal(isSteamFrame(QUEST_UA), false);
    assert.equal(isSteamFrame(DESKTOP_UA), false);
    assert.equal(
      isSteamFrame('Mozilla/5.0 (Linux; Android 14; Pico 4) aarch64'),
      false,
    );
  });
});

describe('frameLayout', () => {
  it('names the layout from the profiles and the browser', () => {
    assert.equal(frameLayout(frameSession().inputSources, DESKTOP_UA), 'frame');
    assert.equal(
      frameLayout(touchSession().inputSources, FRAME_UA),
      'remapped',
    );
    assert.equal(frameLayout(touchSession().inputSources, QUEST_UA), 'other');
    assert.equal(frameLayout([], FRAME_UA), 'none');
  });
});

describe('FrameControls', () => {
  it('reads every Frame control from valve-frame gamepads', () => {
    const session = frameSession();
    const [left, right] = session.inputSources;
    const c = new FrameControls({ userAgent: DESKTOP_UA });
    const L = LAYOUTS['valve-frame'];
    press(left, L.left.dpadUp);
    press(left, L.left.shoulder);
    press(left, L.left.view);
    press(right, L.right.menu);
    press(right, L.right.x);
    press(right, L.right.a);
    c.update(session);
    assert.equal(c.layout, 'frame');
    assert.equal(c.dpadEmulated, false);
    assert.equal(c.dpad.up.justPressed, true);
    assert.equal(c.dpad.down.pressed, false);
    assert.equal(c.left.shoulder.pressed, true);
    assert.equal(c.right.shoulder.pressed, false);
    assert.equal(c.view.pressed, true);
    assert.equal(c.menu.pressed, true);
    assert.equal(c.x.pressed, true);
    assert.equal(c.a.pressed, true);
    c.update(session);
    assert.equal(c.dpad.up.justPressed, false);
    press(left, L.left.dpadUp, false);
    c.update(session);
    assert.equal(c.dpad.up.justReleased, true);
  });

  it('does not take the left mirror slot as the left menu', () => {
    // oculus-touch-v3's left menu is slot 7, which is the Frame's D-pad up.
    const session = frameSession();
    press(session.inputSources[0], 7);
    const c = new FrameControls({ userAgent: DESKTOP_UA });
    c.update(session);
    assert.equal(c.menu.pressed, false);
    assert.equal(c.dpad.up.pressed, true);
  });

  it('falls back on Touch layouts: X/Y on the left, D-pad from the left stick', () => {
    const session = touchSession();
    const [left] = session.inputSources;
    const c = new FrameControls({ userAgent: FRAME_UA });
    press(left, LAYOUTS.touch.left.x);
    left.gamepad.axes[2] = 0.9;
    c.update(session);
    assert.equal(c.layout, 'remapped');
    assert.equal(c.dpadEmulated, true);
    assert.equal(c.x.pressed, true);
    assert.equal(c.dpad.right.justPressed, true);
    assert.equal(c.view.pressed, false);
    assert.equal(c.left.shoulder.pressed, false);
    left.gamepad.axes[2] = 0.6; // hysteresis: still held above 70% of the threshold
    c.update(session);
    assert.equal(c.dpad.right.pressed, true);
    left.gamepad.axes[2] = 0.3;
    c.update(session);
    assert.equal(c.dpad.right.justReleased, true);
  });

  it('turns analog trigger and grip into buttons with hysteresis', () => {
    const session = frameSession();
    const right = session.inputSources[1];
    const c = new FrameControls({ userAgent: DESKTOP_UA });
    right.gamepad.buttons[0].value = 0.8;
    c.update(session);
    assert.equal(c.right.select.justPressed, true);
    right.gamepad.buttons[0].value = 0.65;
    c.update(session);
    assert.equal(c.right.select.pressed, true);
    right.gamepad.buttons[0].value = 0.5;
    c.update(session);
    assert.equal(c.right.select.pressed, false);
  });
});

describe('pulse', () => {
  it('prefers vibrationActuator, then hapticActuators', () => {
    const calls = [];
    const both = {
      vibrationActuator: {
        playEffect: (type, p) => (
          calls.push(['effect', type, p.duration]),
          Promise.resolve()
        ),
      },
      hapticActuators: [
        { pulse: () => (calls.push(['pulse']), Promise.resolve()) },
      ],
    };
    assert.equal(pulse({ gamepad: both }, 0.5, 30), true);
    assert.deepEqual(calls, [['effect', 'dual-rumble', 30]]);
    assert.equal(
      pulse({
        hapticActuators: [
          { pulse: () => (calls.push(['pulse']), Promise.resolve()) },
        ],
      }),
      true,
    );
    assert.deepEqual(calls.at(-1), ['pulse']);
    assert.equal(pulse({ buttons: [] }), false);
  });
});

describe('prepareFrameRendering', () => {
  function fakeRenderer(session) {
    let loop;
    const finished = [];
    const renderer = {
      xr: { setSession: async () => 'set', getSession: () => session },
      setAnimationLoop: (cb) => (loop = cb),
      getContext: () => ({ finish: () => finished.push(1) }),
    };
    return { renderer, run: () => loop?.(0, {}), finished };
  }
  it('leaves other browsers alone', async () => {
    const { renderer, run, finished } = fakeRenderer(touchSession());
    prepareFrameRendering(renderer);
    renderer.setAnimationLoop(() => {});
    run();
    assert.equal(finished.length, 0);
    assert.equal(await renderer.xr.setSession({}), 'set');
  });
  it('always finishes frames when asked to', () => {
    const { renderer, run, finished } = fakeRenderer(frameSession());
    prepareFrameRendering(renderer, { finishXRFrames: true });
    renderer.setAnimationLoop(() => {});
    run();
    assert.equal(finished.length, 1);
  });
  it('hides createProjectionLayer only while the session is set on a Frame', async (t) => {
    const proto = { createProjectionLayer() {} };
    Object.defineProperty(proto, 'createProjectionLayer', {
      value: proto.createProjectionLayer,
      configurable: true,
      writable: true,
    });
    globalThis.XRWebGLBinding = function () {};
    globalThis.XRWebGLBinding.prototype = proto;
    t.after(() => delete globalThis.XRWebGLBinding);
    const ua = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: FRAME_UA },
      configurable: true,
    });
    t.after(() =>
      ua
        ? Object.defineProperty(globalThis, 'navigator', ua)
        : delete globalThis.navigator,
    );
    resetDetectionForTests();
    let seen;
    const renderer = {
      xr: {
        setSession: async () => (seen = 'createProjectionLayer' in proto),
        getSession: () => undefined,
      },
      setAnimationLoop: () => {},
      getContext: () => ({ finish() {} }),
    };
    prepareFrameRendering(renderer);
    await renderer.xr.setSession({});
    assert.equal(seen, false);
    assert.equal('createProjectionLayer' in proto, true);
    assert.deepEqual(
      frameSessionInit({ optionalFeatures: ['local-floor', 'layers'] })
        .optionalFeatures,
      ['local-floor'],
    );
  });
});
