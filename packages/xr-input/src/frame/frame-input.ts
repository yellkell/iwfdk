/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { VALVE_FRAME_PROFILE_ID } from '../gamepad/profiles/valve-frame.js';
import { InputComponent } from '../gamepad/stateful-gamepad.js';
import {
  FRAME_BUTTON_IDS,
  resolveFrameButton,
  type FrameButtonId,
  type FrameGamepadLike,
  type FrameGamepads,
  type FrameHand,
} from './bindings.js';
import {
  FrameButton,
  analogPress,
  stickToDpad,
  type DpadDirections,
} from './hysteresis.js';
import {
  DEFAULT_PINCH_CONFIG,
  PinchDetector,
  type PinchConfig,
  type PinchJoints,
  type PinchState,
} from './pinch.js';
import { isSteamFrameBrowser } from './platform.js';

/**
 * How the browser exposes the controllers:
 * - `frame`: the `valve-frame` profile; every control is physical. Its
 *   gamepad also follows the Touch layout in slots 0-6 (patch 0006), so
 *   Touch-only code works there too; `FrameInput` reads the Frame slots.
 * - `remapped`: another controller profile on an ARM64 Linux browser, i.e. a
 *   Steam Frame whose browser lacks the IWFDK Chromium patch. SteamVR then
 *   presents the Frame controllers as emulated Touch controllers, so the
 *   D-pad, shoulder buttons and view are lost. [verify] the user-agent
 *   heuristic on a Frame.
 * - `other`: any other controller; mapped by component as far as it goes.
 * - `none`: no gamepad-bearing input source.
 */
export type FrameLayout = 'frame' | 'remapped' | 'other' | 'none';

export class FrameControllerState {
  /** A gamepad is connected for this hand. */
  active = false;
  /** WebXR profile id reported by the browser. */
  profileId: string | undefined = undefined;
  /** Analog trigger, 0…1. */
  trigger = 0;
  /** Trigger click, or a deep pull where the runtime reports no click. */
  readonly select = new FrameButton();
  /** Analog grip, 0…1. */
  squeeze = 0;
  /** Grip as a button, with hysteresis. */
  readonly grip = new FrameButton();
  /** Shoulder button (bumper). */
  readonly shoulder = new FrameButton();
  /** Gamepad API convention: x right, **y down**, each -1…1. */
  readonly thumbstick = { x: 0, y: 0 };
  readonly thumbstickButton = new FrameButton();

  reset(): void {
    this.active = false;
    this.profileId = undefined;
    this.trigger = 0;
    this.squeeze = 0;
    this.thumbstick.x = 0;
    this.thumbstick.y = 0;
    this.select.reset();
    this.grip.reset();
    this.shoulder.reset();
    this.thumbstickButton.reset();
  }
}

export class FrameHandState {
  tracked = false;
  pinch: PinchState = {
    pinching: false,
    justPinched: false,
    justReleased: false,
    strength: 0,
  };
}

export interface FrameInputOptions {
  /** Trigger value treated as a click when the runtime reports none. */
  selectOn?: number;
  selectOff?: number;
  gripOn?: number;
  gripOff?: number;
  /** Left-stick deflection that emulates a D-pad press. */
  dpadThreshold?: number;
  pinch?: PinchConfig;
  /** Overrides `navigator.userAgent` for layout detection (tests). */
  userAgent?: string;
}

const DEFAULTS = {
  selectOn: 0.75,
  selectOff: 0.6,
  gripOn: 0.7,
  gripOff: 0.5,
  dpadThreshold: 0.7,
};

/**
 * Steam Frame controller semantics on top of WebXR gamepads: per-hand
 * trigger/grip/shoulder/stick and the gamepad-style A/B/X/Y, menu, view and
 * D-pad, regardless of which profile the browser reports. Port of
 * FramePlayer's `fp-xr` `InputState`.
 */
export class FrameInput {
  layout: FrameLayout = 'none';
  readonly left = new FrameControllerState();
  readonly right = new FrameControllerState();
  readonly buttons: Readonly<Record<FrameButtonId, FrameButton>>;
  readonly dpad: Readonly<
    Record<'up' | 'down' | 'left' | 'right', FrameButton>
  >;
  /** True while the D-pad is emulated from the left stick. */
  dpadEmulated = true;
  readonly hands: Readonly<Record<FrameHand, FrameHandState>> = {
    left: new FrameHandState(),
    right: new FrameHandState(),
  };

  private readonly options: typeof DEFAULTS & { userAgent?: string };
  private readonly pinch: Record<FrameHand, PinchDetector>;
  private dpadEmulation: DpadDirections = [false, false, false, false];
  private gamepads: FrameGamepads = {};

  constructor(options: FrameInputOptions = {}) {
    const { pinch, ...rest } = options;
    this.options = { ...DEFAULTS, ...stripUndefined(rest) };
    this.pinch = {
      left: new PinchDetector(pinch ?? DEFAULT_PINCH_CONFIG),
      right: new PinchDetector(pinch ?? DEFAULT_PINCH_CONFIG),
    };
    const buttons = {} as Record<FrameButtonId, FrameButton>;
    for (const id of FRAME_BUTTON_IDS) {
      buttons[id] = new FrameButton();
    }
    this.buttons = buttons;
    this.dpad = {
      up: buttons.dpadUp,
      down: buttons.dpadDown,
      left: buttons.dpadLeft,
      right: buttons.dpadRight,
    };
  }

  get a() {
    return this.buttons.a;
  }
  get b() {
    return this.buttons.b;
  }
  get x() {
    return this.buttons.x;
  }
  get y() {
    return this.buttons.y;
  }
  get menu() {
    return this.buttons.menu;
  }
  get view() {
    return this.buttons.view;
  }
  controller(hand: FrameHand): FrameControllerState {
    return hand === 'left' ? this.left : this.right;
  }

  setPinchConfig(config: PinchConfig): void {
    this.pinch.left.config = { ...config };
    this.pinch.right.config = { ...config };
  }

  /** Sample the controllers. Call once per frame after the gamepads update. */
  update(gamepads: FrameGamepads): void {
    this.gamepads = gamepads;
    for (const hand of ['left', 'right'] as const) {
      this.updateController(this.controller(hand), gamepads[hand]);
    }

    for (const id of FRAME_BUTTON_IDS) {
      if (id.startsWith('dpad')) {
        continue;
      }
      this.updateButton(id, gamepads);
    }

    const physicalDpad = resolveFrameButton('dpadUp', gamepads) !== undefined;
    this.dpadEmulated = !physicalDpad;
    if (physicalDpad) {
      this.dpadEmulation = [false, false, false, false];
      for (const id of [
        'dpadUp',
        'dpadDown',
        'dpadLeft',
        'dpadRight',
      ] as const) {
        this.updateButton(id, gamepads);
      }
    } else {
      const stick = this.left.thumbstick;
      // Gamepad y is positive down; the emulation expects positive up.
      this.dpadEmulation = stickToDpad(
        stick.x,
        -stick.y,
        this.dpadEmulation,
        this.options.dpadThreshold,
      );
      this.buttons.dpadUp.update(this.dpadEmulation[0], false);
      this.buttons.dpadDown.update(this.dpadEmulation[1], false);
      this.buttons.dpadLeft.update(this.dpadEmulation[2], false);
      this.buttons.dpadRight.update(this.dpadEmulation[3], false);
    }

    this.layout = detectLayout(
      gamepads,
      this.options.userAgent ?? globalThis.navigator?.userAgent ?? '',
    );
  }

  /**
   * Run pinch detection on tracked hands. `inputSources` are the session's
   * input sources; hands without a source, or whose tips are not located,
   * read as untracked (and release any pinch).
   */
  updateHands(
    frame: XRFrame,
    referenceSpace: XRSpace,
    inputSources: Iterable<XRInputSource>,
  ): void {
    const joints: Partial<Record<FrameHand, PinchJoints>> = {};
    if (typeof frame.getJointPose === 'function') {
      for (const source of inputSources) {
        const hand = source.hand;
        if (
          !hand ||
          (source.handedness !== 'left' && source.handedness !== 'right')
        ) {
          continue;
        }
        const thumbJoint = hand.get('thumb-tip');
        const indexJoint = hand.get('index-finger-tip');
        const thumb =
          thumbJoint && frame.getJointPose(thumbJoint, referenceSpace);
        const index =
          indexJoint && frame.getJointPose(indexJoint, referenceSpace);
        if (thumb && index) {
          joints[source.handedness] = {
            thumb: thumb.transform.position,
            thumbRadius: thumb.radius ?? 0,
            index: index.transform.position,
            indexRadius: index.radius ?? 0,
          };
        }
      }
    }
    for (const hand of ['left', 'right'] as const) {
      this.hands[hand].tracked = joints[hand] !== undefined;
      this.hands[hand].pinch = this.pinch[hand].update(joints[hand]);
    }
  }

  /**
   * Vibrate a controller. Best effort: returns false when the browser exposes
   * no haptic actuator for that hand.
   */
  vibrate(hand: FrameHand, amplitude: number, durationMs: number): boolean {
    const gamepad = this.gamepads[hand]?.gamepad as
      | (Gamepad & {
          hapticActuators?: ReadonlyArray<{
            pulse?: (value: number, duration: number) => Promise<boolean>;
          }>;
        })
      | undefined;
    const value = Math.min(1, Math.max(0, amplitude));
    const pulse = gamepad?.hapticActuators?.[0]?.pulse;
    if (pulse) {
      void pulse.call(gamepad!.hapticActuators![0], value, durationMs);
      return true;
    }
    const actuator = gamepad?.vibrationActuator;
    if (actuator?.playEffect) {
      void actuator.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: value,
        weakMagnitude: value,
      });
      return true;
    }
    return false;
  }

  private updateController(
    state: FrameControllerState,
    gamepad: FrameGamepadLike | undefined,
  ): void {
    if (!gamepad) {
      state.reset();
      return;
    }
    const o = this.options;
    state.active = true;
    state.profileId = gamepad.inputSource?.profiles[0];

    state.trigger = gamepad.getButtonValue(InputComponent.Trigger);
    state.select.update(
      gamepad.getButtonPressed(InputComponent.Trigger) ||
        analogPress(
          state.select.pressed,
          state.trigger,
          o.selectOn,
          o.selectOff,
        ),
      gamepad.getButtonTouched(InputComponent.Trigger),
    );

    state.squeeze = gamepad.getButtonValue(InputComponent.Squeeze);
    state.grip.update(
      analogPress(state.grip.pressed, state.squeeze, o.gripOn, o.gripOff),
      state.squeeze > 0.05,
    );

    state.shoulder.update(
      gamepad.getButtonPressed(InputComponent.Shoulder),
      gamepad.getButtonTouched(InputComponent.Shoulder),
    );

    const stick = gamepad.getAxesValues(InputComponent.Thumbstick);
    state.thumbstick.x = stick?.x ?? 0;
    state.thumbstick.y = stick?.y ?? 0;
    state.thumbstickButton.update(
      gamepad.getButtonPressed(InputComponent.Thumbstick),
      gamepad.getButtonTouched(InputComponent.Thumbstick),
    );
  }

  private updateButton(id: FrameButtonId, gamepads: FrameGamepads): void {
    const source = resolveFrameButton(id, gamepads);
    if (!source) {
      this.buttons[id].update(false, false);
      return;
    }
    const gamepad = gamepads[source[0]]!;
    this.buttons[id].update(
      gamepad.getButtonPressed(source[1]),
      gamepad.getButtonTouched(source[1]),
    );
  }
}

function detectLayout(gamepads: FrameGamepads, userAgent: string): FrameLayout {
  if (!gamepads.left && !gamepads.right) {
    return 'none';
  }
  const profiles = [gamepads.left, gamepads.right]
    .map((gamepad) => gamepad?.inputSource?.profiles[0])
    .filter((id): id is string => id !== undefined);
  if (profiles.includes(VALVE_FRAME_PROFILE_ID)) {
    return 'frame';
  }
  if (isSteamFrameBrowser(userAgent)) {
    return 'remapped';
  }
  return 'other';
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
