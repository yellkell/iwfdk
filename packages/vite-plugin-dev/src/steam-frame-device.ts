/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRDevice, metaQuest3, oculusTouchV3 } from 'iwer';

type XRDeviceConfig = ConstructorParameters<typeof XRDevice>[0];
type XRControllerConfig = NonNullable<XRDeviceConfig['controllerConfig']>;
type GamepadConfig = NonNullable<
  XRControllerConfig['layout']['left']
>['gamepad'];
type GamepadButtonConfig = NonNullable<GamepadConfig['buttons'][number]>;

/**
 * Emulated Valve Steam Frame headsets for IWER, so apps (and the agents
 * driving them through MCP) are developed against the Frame rather than a
 * Quest. See FRAME.md, "Agents and the emulator".
 *
 * Two browsers are emulated:
 * - `steamFrame`: Chromium XR, the Frame browser with the IWFDK Chromium
 *   patches. Its controllers report `valve-frame` with the gamepad layout of
 *   FRAME.md section 3 (`@iwsdk/xr-input`'s `ValveFrameGamepadIndex`).
 * - `steamFrameTouch`: a Frame browser without the patches, where SteamVR
 *   presents the Frame controllers as Touch controllers (`oculus-touch`). The
 *   D-pad, shoulders, menu and view don't reach the page; IWFDK's
 *   `frame.layout` reads `remapped`.
 *
 * Both claim only what a Frame browser offers: immersive VR (no AR, hit
 * test, anchors or scene understanding: SteamVR has no OpenXR extensions for
 * them) and no page-selectable frame rate (SteamVR sets it per app).
 *
 * The user agent names an ARM64 Linux CPU. The real Frame browser's reduced
 * user agent says "Linux x86_64" and IWFDK identifies it through
 * `navigator.userAgentData`, which the emulator cannot change; the ARM64 user
 * agent makes `isSteamFrameBrowser()` true all the same, so the emulated page
 * takes the Frame code paths (Frame controller models, rendering).
 */

const binary = (id: string): GamepadButtonConfig => ({ id, type: 'binary' });

const TRIGGER: GamepadButtonConfig = {
  id: 'trigger',
  type: 'analog',
  eventTrigger: 'select',
};
const SQUEEZE: GamepadButtonConfig = {
  id: 'squeeze',
  type: 'analog',
  eventTrigger: 'squeeze',
};

/**
 * Slots 0-6 follow Meta Touch; `null` is a placeholder slot (touchpad 2,
 * thumbrest 6) that always reads released.
 */
function valveFrameGamepad(
  face: [string, string],
  frameOnly: string[],
): GamepadConfig {
  return {
    mapping: oculusTouchV3.layout.right!.gamepad.mapping,
    buttons: [
      TRIGGER,
      SQUEEZE,
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
  };
}

/** The Frame controllers as Chromium XR reports them (IWFDK patch 0006). */
export const valveFrameController: XRControllerConfig = {
  profileId: 'valve-frame',
  fallbackProfileIds: [
    'oculus-touch-v3',
    'oculus-touch',
    'generic-trigger-squeeze-thumbstick',
  ],
  layout: {
    left: {
      // Slots 4/5 carry the right controller's X/Y (see mirrorFrameXY).
      gamepad: valveFrameGamepad(
        ['x-button', 'y-button'],
        ['dpad-up', 'dpad-down', 'dpad-left', 'dpad-right', 'shoulder', 'view'],
      ),
      // The Frame's grip offset is not measured; Touch's is close enough for
      // pointing in the emulator.
      gripOffsetMatrix: oculusTouchV3.layout.left!.gripOffsetMatrix,
      numHapticActuators: 1,
    },
    right: {
      gamepad: valveFrameGamepad(
        ['a-button', 'b-button'],
        ['x-button', 'y-button', 'shoulder', 'menu'],
      ),
      gripOffsetMatrix: oculusTouchV3.layout.right!.gripOffsetMatrix,
      numHapticActuators: 1,
    },
  },
};

/** The Frame controllers through SteamVR's Touch emulation. */
export const steamVRTouchEmulationController: XRControllerConfig = {
  ...oculusTouchV3,
  profileId: 'oculus-touch',
  fallbackProfileIds: ['generic-trigger-squeeze-thumbstick'],
};

const FRAME_USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

const frameHeadset = {
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
  // Chromium XR's launcher default; SteamVR's per-app setting decides.
  internalNominalFrameRate: 90,
  userAgent: FRAME_USER_AGENT,
} satisfies Partial<XRDeviceConfig>;

/** A Steam Frame running Chromium XR (the IWFDK Chromium patches). */
export const steamFrame: XRDeviceConfig = {
  environmentBlendModes: {
    'immersive-vr': metaQuest3.environmentBlendModes['immersive-vr'],
  },
  interactionMode: metaQuest3.interactionMode,
  ...frameHeadset,
  name: 'Valve Steam Frame',
  controllerConfig: valveFrameController,
};

/** A Steam Frame running a browser without the IWFDK Chromium patches. */
export const steamFrameTouch: XRDeviceConfig = {
  ...steamFrame,
  name: 'Valve Steam Frame (Touch emulation)',
  controllerConfig: steamVRTouchEmulationController,
};

const MIRRORED_BUTTONS = ['x-button', 'y-button'];

type ButtonMethod = 'updateButtonValue' | 'setButtonValueImmediate';

/**
 * Chromium XR copies the right controller's X/Y into the left gamepad's
 * slots 4/5, where Quest code reads X/Y. Make a press of X or Y on either
 * emulated controller show on both, as the one physical button does.
 */
export function mirrorFrameXY(device: XRDevice): void {
  const { left, right } = device.controllers;
  if (!left || !right) {
    return;
  }
  const pair = [
    [left, right],
    [right, left],
  ] as const;
  const originals = new Map(
    [left, right].map((controller) => [
      controller,
      {
        updateButtonValue: controller.updateButtonValue.bind(controller),
        setButtonValueImmediate:
          controller.setButtonValueImmediate.bind(controller),
        updateButtonTouch: controller.updateButtonTouch.bind(controller),
      },
    ]),
  );
  for (const [controller, other] of pair) {
    const own = originals.get(controller)!;
    const mirrored = originals.get(other)!;
    for (const method of [
      'updateButtonValue',
      'setButtonValueImmediate',
    ] as ButtonMethod[]) {
      controller[method] = (id: string, value: number) => {
        own[method](id, value);
        if (MIRRORED_BUTTONS.includes(id)) {
          mirrored[method](id, value);
        }
      };
    }
    controller.updateButtonTouch = (id: string, touched: boolean) => {
      own.updateButtonTouch(id, touched);
      if (MIRRORED_BUTTONS.includes(id)) {
        mirrored.updateButtonTouch(id, touched);
      }
    };
  }
}
