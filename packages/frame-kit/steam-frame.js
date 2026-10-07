/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Steam Frame support for any WebXR app (three.js or not): detection, the
// Frame's controls with a fallback for other browsers, haptics, and the
// rendering fixes Frame browsers need. No dependencies. See README.md and
// FRAME.md section 5 for why each piece exists.

/** Profile id of the Frame controllers in Chromium XR (IWFDK patches 0004/0006). */
export const VALVE_FRAME = 'valve-frame';

/**
 * Gamepad button indices. `valve-frame` is fixed by the Chromium patches:
 * slots 0-6 follow Meta Touch, the Frame-only controls follow from 7, and the
 * browser mirrors the right controller's X/Y into left slots 4/5. `touch` is
 * the Meta Touch layout (`oculus-touch*`), which is also what a Frame browser
 * without the patches reports through SteamVR's Touch emulation.
 */
export const LAYOUTS = {
  [VALVE_FRAME]: {
    left: {
      trigger: 0,
      squeeze: 1,
      thumbstick: 3,
      x: 4,
      y: 5,
      dpadUp: 7,
      dpadDown: 8,
      dpadLeft: 9,
      dpadRight: 10,
      shoulder: 11,
      view: 12,
    },
    right: {
      trigger: 0,
      squeeze: 1,
      thumbstick: 3,
      a: 4,
      b: 5,
      x: 7,
      y: 8,
      shoulder: 9,
      menu: 10,
    },
  },
  touch: {
    left: { trigger: 0, squeeze: 1, thumbstick: 3, x: 4, y: 5, menu: 7 },
    right: { trigger: 0, squeeze: 1, thumbstick: 3, a: 4, b: 5 },
  },
};
/** Thumbstick axes on both layouts (Gamepad API: x right, y down). */
export const STICK_AXES = { x: 2, y: 3 };

// ---------------------------------------------------------------------------
// Detection

const OTHER_HEADSET = /OculusBrowser|Quest|Pico|Android|Wolvic/i;
let armLinux;
let detection;

/**
 * Whether this is a browser on a Steam Frame (ARM64 SteamOS). Chromium's
 * reduced user agent says "Linux x86_64" there, so the CPU comes from
 * `navigator.userAgentData`. Never matches Quest, Pico or Android browsers.
 */
export function detectSteamFrame() {
  detection ??= (async () => {
    const nav = globalThis.navigator;
    try {
      if (nav?.userAgentData) {
        const { platform, architecture } =
          await nav.userAgentData.getHighEntropyValues([
            'platform',
            'architecture',
          ]);
        armLinux =
          platform === 'Linux' &&
          architecture === 'arm' &&
          !OTHER_HEADSET.test(nav.userAgent ?? '');
      }
    } catch {
      // Fall back to the user agent.
    }
    return isSteamFrame();
  })();
  return detection;
}

/** Synchronous answer; exact once {@link detectSteamFrame} has resolved (it starts on import). */
export function isSteamFrame(
  userAgent = globalThis.navigator?.userAgent ?? '',
) {
  return (
    armLinux === true ||
    (/Linux (aarch64|arm64)/i.test(userAgent) && !OTHER_HEADSET.test(userAgent))
  );
}
void detectSteamFrame();

/** @internal tests */
export function resetDetectionForTests() {
  armLinux = undefined;
  detection = undefined;
}

// ---------------------------------------------------------------------------
// Controls

function layoutOf(source) {
  return source?.profiles?.[0] === VALVE_FRAME
    ? LAYOUTS[VALVE_FRAME]
    : LAYOUTS.touch;
}

/**
 * `frame` (Chromium XR: every Frame control), `remapped` (a Frame browser that
 * reports Touch controllers: no D-pad, shoulders or view), `other` (another
 * headset) or `none`.
 */
export function frameLayout(sources, userAgent) {
  const list = [...(sources ?? [])].filter((s) => s.gamepad);
  if (!list.length) return 'none';
  if (list.some((s) => s.profiles?.[0] === VALVE_FRAME)) return 'frame';
  return isSteamFrame(userAgent) ? 'remapped' : 'other';
}

export class FrameButton {
  pressed = false;
  justPressed = false;
  justReleased = false;
  touched = false;
  set(pressed, touched = pressed) {
    this.justPressed = pressed && !this.pressed;
    this.justReleased = !pressed && this.pressed;
    this.pressed = pressed;
    this.touched = touched;
  }
}

class Hand {
  active = false;
  profile = undefined;
  trigger = 0;
  squeeze = 0;
  select = new FrameButton();
  grip = new FrameButton();
  shoulder = new FrameButton();
  thumbstick = { x: 0, y: 0 };
  thumbstickButton = new FrameButton();
}

// Where each gamepad-style control comes from, best first: on valve-frame the
// left X/Y are the browser's mirror, so the right ones win.
const SOURCES = {
  a: [['right', 'a']],
  b: [['right', 'b']],
  x: [
    ['right', 'x'],
    ['left', 'x'],
  ],
  y: [
    ['right', 'y'],
    ['left', 'y'],
  ],
  menu: [
    ['right', 'menu'],
    ['left', 'menu'],
  ],
  view: [['left', 'view']],
  dpadUp: [['left', 'dpadUp']],
  dpadDown: [['left', 'dpadDown']],
  dpadLeft: [['left', 'dpadLeft']],
  dpadRight: [['left', 'dpadRight']],
};

/**
 * The Frame's controls, read from the session's input sources every frame
 * (`controls.update(renderer.xr.getSession())`), whichever layout the browser
 * reports. Where there is no D-pad (Touch layouts) it comes from the left
 * stick, so D-pad shortcuts keep working; shoulders and view stay released.
 */
export class FrameControls {
  layout = 'none';
  dpadEmulated = true;
  left = new Hand();
  right = new Hand();
  a = new FrameButton();
  b = new FrameButton();
  x = new FrameButton();
  y = new FrameButton();
  menu = new FrameButton();
  view = new FrameButton();
  dpad = {
    up: new FrameButton(),
    down: new FrameButton(),
    left: new FrameButton(),
    right: new FrameButton(),
  };

  constructor({ dpadThreshold = 0.7, userAgent } = {}) {
    this.dpadThreshold = dpadThreshold;
    this.userAgent = userAgent;
  }

  update(session) {
    const sources = { left: undefined, right: undefined };
    for (const s of session?.inputSources ?? []) {
      if (s.gamepad && (s.handedness === 'left' || s.handedness === 'right'))
        sources[s.handedness] = s;
    }
    this.layout = frameLayout(
      Object.values(sources).filter(Boolean),
      this.userAgent,
    );
    const read = (hand, name) => {
      const s = sources[hand];
      const i = layoutOf(s)[hand][name];
      return i === undefined ? undefined : s?.gamepad.buttons[i];
    };
    for (const hand of ['left', 'right']) {
      const h = this[hand];
      const s = sources[hand];
      h.active = !!s;
      h.profile = s?.profiles?.[0];
      const trigger = read(hand, 'trigger');
      const squeeze = read(hand, 'squeeze');
      h.trigger = trigger?.value ?? 0;
      h.squeeze = squeeze?.value ?? 0;
      h.select.set(
        !!trigger?.pressed || h.trigger > (h.select.pressed ? 0.6 : 0.75),
      );
      h.grip.set(
        !!squeeze?.pressed || h.squeeze > (h.grip.pressed ? 0.5 : 0.7),
      );
      const shoulder = read(hand, 'shoulder');
      h.shoulder.set(!!shoulder?.pressed, !!shoulder?.touched);
      const stick = read(hand, 'thumbstick');
      h.thumbstickButton.set(!!stick?.pressed, !!stick?.touched);
      h.thumbstick.x = s?.gamepad.axes[STICK_AXES.x] ?? 0;
      h.thumbstick.y = s?.gamepad.axes[STICK_AXES.y] ?? 0;
    }
    const resolve = (id) => {
      for (const [hand, name] of SOURCES[id]) {
        const b = read(hand, name);
        if (b) return b;
      }
      return undefined;
    };
    for (const id of ['a', 'b', 'x', 'y', 'menu', 'view']) {
      const b = resolve(id);
      this[id].set(!!b?.pressed, !!b?.touched);
    }
    const physical = resolve('dpadUp') !== undefined;
    this.dpadEmulated = !physical;
    const stick = this.left.thumbstick;
    for (const [dir, id, value] of [
      ['up', 'dpadUp', -stick.y],
      ['down', 'dpadDown', stick.y],
      ['left', 'dpadLeft', -stick.x],
      ['right', 'dpadRight', stick.x],
    ]) {
      if (physical) {
        const b = resolve(id);
        this.dpad[dir].set(!!b?.pressed, !!b?.touched);
      } else {
        const held = this.dpad[dir].pressed;
        this.dpad[dir].set(
          value > (held ? this.dpadThreshold * 0.7 : this.dpadThreshold),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Haptics

/**
 * Vibrate a controller (an XRInputSource or its gamepad), best effort.
 * Chromium XR vibrates through `vibrationActuator.playEffect`, Quest Browser
 * through `hapticActuators[0].pulse`; this tries both. Returns false when the
 * browser exposes neither.
 */
export function pulse(sourceOrGamepad, intensity = 0.6, durationMs = 40) {
  const gamepad = sourceOrGamepad?.gamepad ?? sourceOrGamepad;
  const strength = Math.min(1, Math.max(0, intensity));
  const effect = gamepad?.vibrationActuator;
  if (effect?.playEffect) {
    effect
      .playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: strength,
        weakMagnitude: strength,
      })
      .catch?.(() => {});
    return true;
  }
  const actuator = gamepad?.hapticActuators?.[0];
  if (actuator?.pulse) {
    actuator.pulse(strength, durationMs).catch?.(() => {});
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rendering

/**
 * Apply the Frame browsers' rendering fixes to a three.js WebGLRenderer. Call
 * it once, before `renderer.setAnimationLoop` and before entering XR.
 *
 * - Frame browsers can't composite WebXR projection layers (black headset), and
 *   three.js uses one whenever `XRWebGLBinding.createProjectionLayer` exists, so
 *   it is hidden while three.js sets the session up.
 * - Frame browsers without Chromium XR's fix lose the right eye unless each XR
 *   frame ends with `gl.finish()`. `finishXRFrames: 'auto'` does that only on a
 *   Frame until a controller reports `valve-frame` (Chromium XR needs none).
 *
 * Does nothing outside a Steam Frame browser unless `finishXRFrames` is `true`.
 */
export function prepareFrameRendering(
  renderer,
  { finishXRFrames = 'auto' } = {},
) {
  const xr = renderer.xr;
  const setSession = xr.setSession.bind(xr);
  xr.setSession = async (session) => {
    const proto = globalThis.XRWebGLBinding?.prototype;
    const descriptor =
      proto && isSteamFrame()
        ? Object.getOwnPropertyDescriptor(proto, 'createProjectionLayer')
        : undefined;
    if (!descriptor?.configurable) return setSession(session);
    delete proto.createProjectionLayer;
    try {
      return await setSession(session);
    } finally {
      Object.defineProperty(proto, 'createProjectionLayer', descriptor);
    }
  };

  let valveFrameSeen = false;
  const shouldFinish = () => {
    const session = xr.getSession?.();
    if (!session || finishXRFrames === false) return false;
    if (finishXRFrames === true) return true;
    if (valveFrameSeen || !isSteamFrame()) return false;
    if (
      [...session.inputSources].some((s) => s.profiles?.includes(VALVE_FRAME))
    ) {
      valveFrameSeen = true;
      return false;
    }
    return true;
  };
  const setAnimationLoop = renderer.setAnimationLoop.bind(renderer);
  renderer.setAnimationLoop = (callback) =>
    setAnimationLoop(
      callback &&
        ((time, frame) => {
          callback(time, frame);
          if (frame && shouldFinish()) renderer.getContext().finish();
        }),
    );
}

/** Session features for a Frame: ask for `layers` only if you truly need it. */
export function frameSessionInit(init = {}) {
  if (!isSteamFrame()) return init;
  const drop = (list) => list?.filter((f) => f !== 'layers');
  return { ...init, optionalFeatures: drop(init.optionalFeatures) };
}
