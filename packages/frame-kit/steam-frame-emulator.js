/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// A virtual Steam Frame for any WebXR page, for development: the IWER
// emulator with the Frame's controllers (the same device IWFDK's dev server
// emulates). Load it only in development, before the app requests a session:
//
//   if (location.hostname === 'localhost') {
//     const { installFrameEmulator } = await import('./steam-frame-emulator.js');
//     await installFrameEmulator();          // or { device: 'steamFrameTouch' }
//   }
//
// Then press the Frame's buttons from code, DevTools, or a coding agent's
// browser tool: `frameEmulator.press('left', 'dpad-up')`.

export const IWER_URL =
  'https://cdn.jsdelivr.net/npm/iwer@2.5.0/build/iwer.module.js';

const FRAME_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

/**
 * IWER device configs: `steamFrame` is Chromium XR (`valve-frame` controllers,
 * FRAME.md section 3); `steamFrameTouch` a Frame browser without the IWFDK
 * patches (SteamVR's Touch emulation). Kept identical to
 * packages/vite-plugin-dev/src/steam-frame-device.ts (a test checks).
 */
export function steamFrameDeviceConfig(iwer, kind = 'steamFrame') {
  const { metaQuest3, oculusTouchV3 } = iwer;
  const binary = (id) => ({ id, type: 'binary' });
  const gamepad = (face, frameOnly) => ({
    mapping: oculusTouchV3.layout.right.gamepad.mapping,
    buttons: [
      { id: 'trigger', type: 'analog', eventTrigger: 'select' },
      { id: 'squeeze', type: 'analog', eventTrigger: 'squeeze' },
      null,
      binary('thumbstick'),
      binary(face[0]),
      binary(face[1]),
      null,
      ...frameOnly.map(binary),
    ],
    axes: [
      null,
      null,
      { id: 'thumbstick', type: 'x-axis' },
      { id: 'thumbstick', type: 'y-axis' },
    ],
  });
  const valveFrame = {
    profileId: 'valve-frame',
    fallbackProfileIds: [
      'oculus-touch-v3',
      'oculus-touch',
      'generic-trigger-squeeze-thumbstick',
    ],
    layout: {
      left: {
        gamepad: gamepad(
          ['x-button', 'y-button'],
          [
            'dpad-up',
            'dpad-down',
            'dpad-left',
            'dpad-right',
            'shoulder',
            'view',
          ],
        ),
        gripOffsetMatrix: oculusTouchV3.layout.left.gripOffsetMatrix,
        numHapticActuators: 1,
      },
      right: {
        gamepad: gamepad(
          ['a-button', 'b-button'],
          ['x-button', 'y-button', 'shoulder', 'menu'],
        ),
        gripOffsetMatrix: oculusTouchV3.layout.right.gripOffsetMatrix,
        numHapticActuators: 1,
      },
    },
  };
  const touch = {
    ...oculusTouchV3,
    profileId: 'oculus-touch',
    fallbackProfileIds: ['generic-trigger-squeeze-thumbstick'],
  };
  const frame = {
    environmentBlendModes: {
      'immersive-vr': metaQuest3.environmentBlendModes['immersive-vr'],
    },
    interactionMode: metaQuest3.interactionMode,
    supportedSessionModes: ['inline', 'immersive-vr'],
    supportedFeatures: [
      'viewer',
      'local',
      'local-floor',
      'bounded-floor',
      'hand-tracking',
    ],
    supportedFrameRates: [],
    isSystemKeyboardSupported: false,
    internalNominalFrameRate: 90,
    userAgent: FRAME_USER_AGENT,
    name: 'Valve Steam Frame',
    controllerConfig: valveFrame,
  };
  return kind === 'steamFrameTouch'
    ? {
        ...frame,
        name: 'Valve Steam Frame (Touch emulation)',
        controllerConfig: touch,
      }
    : frame;
}

/** Short names accepted by `press`/`set`, as on the controllers. */
const IDS = {
  a: 'a-button',
  b: 'b-button',
  x: 'x-button',
  y: 'y-button',
  grip: 'squeeze',
  stick: 'thumbstick',
};
const MIRRORED = ['x-button', 'y-button'];

/**
 * Install the virtual Frame as the page's WebXR runtime and return its API
 * (also `window.frameEmulator`):
 * - `press(hand, name, ms = 150)` / `set(hand, name, value)`: buttons by name
 *   (`trigger`, `squeeze`, `thumbstick`, `a` `b` `x` `y`, `menu`, `view`,
 *   `shoulder`, `dpad-up` ...); `buttons(hand)` lists them.
 * - `stick(hand, x, y)`: thumbstick, Gamepad API axes (y down).
 * - `place(target, position, quaternion?)`: `'head'`, `'left'` or `'right'`.
 * - `device`: the IWER XRDevice.
 */
export async function installFrameEmulator({
  device = 'steamFrame',
  iwer,
  iwerUrl = IWER_URL,
} = {}) {
  iwer ??= await import(/* @vite-ignore */ iwerUrl);
  const xrDevice = new iwer.XRDevice(steamFrameDeviceConfig(iwer, device));
  const controller = (hand) => {
    const c = xrDevice.controllers[hand];
    if (!c) throw new Error(`No ${hand} controller`);
    return c;
  };
  const ids = (hand) =>
    controller(hand)
      .gamepadConfig.buttons.filter(Boolean)
      .map((b) => b.id);
  const resolve = (hand, name) => {
    const id = IDS[name] ?? name;
    if (!ids(hand).includes(id)) {
      throw new Error(
        `The ${device} ${hand} controller has no "${name}". Buttons: ${ids(hand).join(', ')}`,
      );
    }
    return id;
  };
  const set = (hand, name, value) => {
    const id = resolve(hand, name);
    const hands =
      device === 'steamFrame' && MIRRORED.includes(id)
        ? ['left', 'right']
        : [hand];
    for (const h of hands) controller(h).updateButtonValue(id, value);
  };
  const api = {
    device: xrDevice,
    kind: device,
    buttons: (hand) => ids(hand),
    set,
    press: async (hand, name, ms = 150) => {
      set(hand, name, 1);
      await new Promise((r) => setTimeout(r, ms));
      set(hand, name, 0);
    },
    stick: (hand, x, y) => controller(hand).updateAxes('thumbstick', x, y),
    place: (target, position, quaternion) => {
      const t = target === 'head' ? xrDevice : controller(target);
      t.position.set(...position);
      if (quaternion) t.quaternion.set(...quaternion);
    },
  };
  xrDevice.installRuntime({ forceInstall: true });
  globalThis.frameEmulator = api;
  return api;
}
