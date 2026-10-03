/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  AxesState,
  InputComponent,
  type XRInputManager,
} from '@iwsdk/xr-input';
import {
  BrowserGamepadAxis,
  BrowserGamepadButton,
  StatefulBrowserGamepad,
} from './stateful-browser-gamepad.js';
import { StatefulKeyboard } from './stateful-keyboard.js';

export const InputActions = {
  LocomotionMove: 'locomotion.move',
  LocomotionTurn: 'locomotion.turn',
  LocomotionJump: 'locomotion.jump',
  LocomotionTeleportAim: 'locomotion.teleportAim',
  LocomotionTeleportCommit: 'locomotion.teleportCommit',
  InteractionSelect: 'interaction.select',
} as const;

export type InputActionName =
  | (typeof InputActions)[keyof typeof InputActions]
  | (string & {});

export type InputActionProfile = 'xr' | 'browser-first-person';

export type InputActionDefaultBindingOptions = {
  keyboard?: boolean;
  gamepad?: boolean;
};

type AxisKeyBinding = {
  source: 'keyboard';
  action: InputActionName;
  kind: 'axis2d';
  negativeX?: string[];
  positiveX?: string[];
  negativeY?: string[];
  positiveY?: string[];
};

type KeyboardButtonBinding = {
  source: 'keyboard';
  action: InputActionName;
  kind: 'button';
  code: string;
};

type BrowserGamepadAxis2DBinding = {
  source: 'browserGamepad';
  action: InputActionName;
  kind: 'axis2d';
  gamepadIndex?: number;
  axis: BrowserGamepadAxis;
};

type BrowserGamepadAxis1DBinding = {
  source: 'browserGamepad';
  action: InputActionName;
  kind: 'axis1d';
  gamepadIndex?: number;
  axis: BrowserGamepadAxis;
  component?: 'x' | 'y';
};

type BrowserGamepadButtonBinding = {
  source: 'browserGamepad';
  action: InputActionName;
  kind: 'button';
  gamepadIndex?: number;
  button: BrowserGamepadButton;
};

type XRGamepadAxis2DBinding = {
  source: 'xrGamepad';
  action: InputActionName;
  kind: 'axis2d';
  handedness: 'left' | 'right';
  componentId: InputComponent;
};

type XRGamepadAxis1DBinding = {
  source: 'xrGamepad';
  action: InputActionName;
  kind: 'axis1d';
  handedness: 'left' | 'right';
  componentId: InputComponent;
  component?: 'x' | 'y';
};

type XRGamepadButtonBinding = {
  source: 'xrGamepad';
  action: InputActionName;
  kind: 'button';
  handedness: 'left' | 'right';
  button: InputComponent;
};

type XRGamepadAxesDirectionBinding = {
  source: 'xrGamepadAxesDirection';
  action: InputActionName;
  kind: 'button';
  handedness: 'left' | 'right';
  componentId: InputComponent;
  state: AxesState;
};

export type InputActionBinding =
  | AxisKeyBinding
  | KeyboardButtonBinding
  | BrowserGamepadAxis2DBinding
  | BrowserGamepadAxis1DBinding
  | BrowserGamepadButtonBinding
  | XRGamepadAxis2DBinding
  | XRGamepadAxis1DBinding
  | XRGamepadButtonBinding
  | XRGamepadAxesDirectionBinding;

export type InputActionContext = {
  keyboard: StatefulKeyboard;
  browserGamepads: Array<StatefulBrowserGamepad | undefined>;
  xr: XRInputManager;
};

type ButtonState = {
  pressed: boolean;
  down: boolean;
  up: boolean;
};

type Axis1DState = {
  previous: number;
  current: number;
};

type Axis2DState = {
  previousX: number;
  previousY: number;
  x: number;
  y: number;
};

const DEFAULT_THRESHOLD = 0.8;

function clamp(value: number, min = -1, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function anyKeyPressed(keyboard: StatefulKeyboard, codes?: string[]): boolean {
  return !!codes?.some((code) => keyboard.getKeyPressed(code));
}

export class InputActionManager {
  private readonly bindings: InputActionBinding[] = [];
  private readonly buttonStates = new Map<InputActionName, ButtonState>();
  private readonly axis1DStates = new Map<InputActionName, Axis1DState>();
  private readonly axis2DStates = new Map<InputActionName, Axis2DState>();

  constructor() {
    this.enableDefaultBindings('xr');
  }

  enableDefaultBindings(
    profile: InputActionProfile,
    options: InputActionDefaultBindingOptions = {},
  ): void {
    const bindings = this.createDefaultBindings(profile, options);
    for (const binding of bindings) {
      if (!this.bindings.some((existing) => bindingsEqual(existing, binding))) {
        this.bindings.push(binding);
      }
    }
  }

  clearBindings(action?: InputActionName): void {
    if (!action) {
      this.bindings.length = 0;
      return;
    }

    for (let index = this.bindings.length - 1; index >= 0; index--) {
      if (this.bindings[index].action === action) {
        this.bindings.splice(index, 1);
      }
    }
  }

  addBinding(binding: InputActionBinding): void {
    this.bindings.push(binding);
  }

  addBindings(bindings: InputActionBinding[]): void {
    this.bindings.push(...bindings);
  }

  removeBinding(binding: InputActionBinding): boolean {
    const index = this.bindings.findIndex((existing) =>
      bindingsEqual(existing, binding),
    );
    if (index === -1) {
      return false;
    }

    this.bindings.splice(index, 1);
    return true;
  }

  getBindings(action?: InputActionName): InputActionBinding[] {
    return this.bindings
      .filter((binding) => !action || binding.action === action)
      .map(cloneBinding);
  }

  update(context: InputActionContext): void {
    this.prepareFrame();

    for (const binding of this.bindings) {
      if (binding.kind === 'axis2d') {
        this.applyAxis2DBinding(context, binding);
      } else if (binding.kind === 'axis1d') {
        this.applyAxis1DBinding(context, binding);
      } else {
        this.applyButtonBinding(context, binding);
      }
    }

    for (const state of this.axis1DStates.values()) {
      state.current = clamp(state.current);
    }
    for (const state of this.axis2DStates.values()) {
      state.x = clamp(state.x);
      state.y = clamp(state.y);
    }
  }

  getButtonPressed(action: InputActionName): boolean {
    return this.buttonStates.get(action)?.pressed ?? false;
  }

  getButtonDown(action: InputActionName): boolean {
    return this.buttonStates.get(action)?.down ?? false;
  }

  getButtonUp(action: InputActionName): boolean {
    return this.buttonStates.get(action)?.up ?? false;
  }

  getAxis1D(action: InputActionName): number {
    return this.axis1DStates.get(action)?.current ?? 0;
  }

  getAxis1DEnteringPositive(
    action: InputActionName,
    threshold = DEFAULT_THRESHOLD,
  ): boolean {
    const state = this.axis1DStates.get(action);
    return !!state && state.current >= threshold && state.previous < threshold;
  }

  getAxis1DEnteringNegative(
    action: InputActionName,
    threshold = DEFAULT_THRESHOLD,
  ): boolean {
    const state = this.axis1DStates.get(action);
    return (
      !!state && state.current <= -threshold && state.previous > -threshold
    );
  }

  getAxis2D(
    action: InputActionName,
    out: { x: number; y: number } = { x: 0, y: 0 },
  ): { x: number; y: number } {
    const state = this.axis2DStates.get(action);
    out.x = state?.x ?? 0;
    out.y = state?.y ?? 0;
    return out;
  }

  private prepareFrame(): void {
    for (const state of this.buttonStates.values()) {
      state.down = false;
      state.up = false;
      state.pressed = false;
    }

    for (const state of this.axis1DStates.values()) {
      state.previous = state.current;
      state.current = 0;
    }

    for (const state of this.axis2DStates.values()) {
      state.previousX = state.x;
      state.previousY = state.y;
      state.x = 0;
      state.y = 0;
    }
  }

  private applyAxis2DBinding(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'axis2d' },
  ): void {
    const state = this.getAxis2DState(binding.action);

    if (binding.source === 'keyboard') {
      state.x += anyKeyPressed(context.keyboard, binding.positiveX) ? 1 : 0;
      state.x -= anyKeyPressed(context.keyboard, binding.negativeX) ? 1 : 0;
      state.y += anyKeyPressed(context.keyboard, binding.positiveY) ? 1 : 0;
      state.y -= anyKeyPressed(context.keyboard, binding.negativeY) ? 1 : 0;
      return;
    }

    const axisValues = this.getAxesValues(context, binding);
    if (axisValues) {
      state.x += axisValues.x;
      state.y += axisValues.y;
    }
  }

  private applyAxis1DBinding(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'axis1d' },
  ): void {
    const state = this.getAxis1DState(binding.action);
    const axisValues = this.getAxesValues(context, binding);
    if (!axisValues) {
      return;
    }

    state.current += binding.component === 'y' ? axisValues.y : axisValues.x;
  }

  private applyButtonBinding(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'button' },
  ): void {
    const state = this.getButtonState(binding.action);
    const pressed = this.getBindingButtonPressed(context, binding);
    const down = this.getBindingButtonDown(context, binding);
    const up = this.getBindingButtonUp(context, binding);

    state.pressed ||= pressed;
    state.down ||= down;
    state.up ||= up;
  }

  private getAxesValues(
    context: InputActionContext,
    binding:
      | (InputActionBinding & { kind: 'axis2d' })
      | (InputActionBinding & { kind: 'axis1d' }),
  ): { x: number; y: number } | undefined {
    if (binding.source === 'browserGamepad') {
      const gamepad = this.getBrowserGamepad(context, binding.gamepadIndex);
      return gamepad?.getAxesValues(binding.axis);
    }

    if (binding.source === 'xrGamepad') {
      return context.xr.gamepads[binding.handedness]?.getAxesValues(
        binding.componentId,
      );
    }

    return undefined;
  }

  private getBindingButtonPressed(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'button' },
  ): boolean {
    if (binding.source === 'keyboard') {
      return context.keyboard.getKeyPressed(binding.code);
    }
    if (binding.source === 'browserGamepad') {
      return (
        this.getBrowserGamepad(context, binding.gamepadIndex)?.getButtonPressed(
          binding.button,
        ) ?? false
      );
    }
    if (binding.source === 'xrGamepad') {
      return (
        context.xr.gamepads[binding.handedness]?.getButtonPressed(
          binding.button,
        ) ?? false
      );
    }
    return (
      context.xr.gamepads[binding.handedness]?.getAxesState(
        binding.componentId,
      ) === binding.state
    );
  }

  private getBindingButtonDown(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'button' },
  ): boolean {
    if (binding.source === 'keyboard') {
      return context.keyboard.getKeyDown(binding.code);
    }
    if (binding.source === 'browserGamepad') {
      return (
        this.getBrowserGamepad(context, binding.gamepadIndex)?.getButtonDown(
          binding.button,
        ) ?? false
      );
    }
    if (binding.source === 'xrGamepad') {
      return (
        context.xr.gamepads[binding.handedness]?.getButtonDown(
          binding.button,
        ) ?? false
      );
    }
    return (
      context.xr.gamepads[binding.handedness]?.getAxesEnteringState(
        binding.componentId,
        binding.state,
      ) ?? false
    );
  }

  private getBindingButtonUp(
    context: InputActionContext,
    binding: InputActionBinding & { kind: 'button' },
  ): boolean {
    if (binding.source === 'keyboard') {
      return context.keyboard.getKeyUp(binding.code);
    }
    if (binding.source === 'browserGamepad') {
      return (
        this.getBrowserGamepad(context, binding.gamepadIndex)?.getButtonUp(
          binding.button,
        ) ?? false
      );
    }
    if (binding.source === 'xrGamepad') {
      return (
        context.xr.gamepads[binding.handedness]?.getButtonUp(binding.button) ??
        false
      );
    }
    return (
      context.xr.gamepads[binding.handedness]?.getAxesLeavingState(
        binding.componentId,
        binding.state,
      ) ?? false
    );
  }

  private getBrowserGamepad(
    context: InputActionContext,
    gamepadIndex?: number,
  ): StatefulBrowserGamepad | undefined {
    if (gamepadIndex !== undefined) {
      return context.browserGamepads[gamepadIndex];
    }
    return context.browserGamepads.find((gamepad) => gamepad?.connected);
  }

  private getButtonState(action: InputActionName): ButtonState {
    let state = this.buttonStates.get(action);
    if (!state) {
      state = { pressed: false, down: false, up: false };
      this.buttonStates.set(action, state);
    }
    return state;
  }

  private getAxis1DState(action: InputActionName): Axis1DState {
    let state = this.axis1DStates.get(action);
    if (!state) {
      state = { previous: 0, current: 0 };
      this.axis1DStates.set(action, state);
    }
    return state;
  }

  private getAxis2DState(action: InputActionName): Axis2DState {
    let state = this.axis2DStates.get(action);
    if (!state) {
      state = { previousX: 0, previousY: 0, x: 0, y: 0 };
      this.axis2DStates.set(action, state);
    }
    return state;
  }

  private createDefaultBindings(
    profile: InputActionProfile,
    options: InputActionDefaultBindingOptions,
  ): InputActionBinding[] {
    if (profile === 'browser-first-person') {
      return this.createBrowserFirstPersonBindings(options);
    }
    return [
      {
        source: 'xrGamepad',
        kind: 'axis2d',
        action: InputActions.LocomotionMove,
        handedness: 'left',
        componentId: InputComponent.Thumbstick,
      },
      {
        source: 'xrGamepad',
        kind: 'axis1d',
        action: InputActions.LocomotionTurn,
        handedness: 'right',
        componentId: InputComponent.Thumbstick,
        component: 'x',
      },
      {
        source: 'xrGamepad',
        kind: 'button',
        action: InputActions.LocomotionJump,
        handedness: 'right',
        button: InputComponent.A_Button,
      },
      {
        source: 'xrGamepadAxesDirection',
        kind: 'button',
        action: InputActions.LocomotionTeleportAim,
        handedness: 'right',
        componentId: InputComponent.Thumbstick,
        state: AxesState.Down,
      },
    ];
  }

  private createBrowserFirstPersonBindings(
    options: InputActionDefaultBindingOptions,
  ): InputActionBinding[] {
    const keyboardEnabled = options.keyboard ?? true;
    const gamepadEnabled = options.gamepad ?? true;
    const bindings: InputActionBinding[] = [];

    if (keyboardEnabled) {
      bindings.push(
        {
          source: 'keyboard',
          kind: 'axis2d',
          action: InputActions.LocomotionMove,
          negativeX: ['KeyA', 'ArrowLeft'],
          positiveX: ['KeyD', 'ArrowRight'],
          negativeY: ['KeyW', 'ArrowUp'],
          positiveY: ['KeyS', 'ArrowDown'],
        },
        {
          source: 'keyboard',
          kind: 'button',
          action: InputActions.LocomotionJump,
          code: 'Space',
        },
      );
    }

    if (gamepadEnabled) {
      bindings.push(
        {
          source: 'browserGamepad',
          kind: 'axis2d',
          action: InputActions.LocomotionMove,
          axis: BrowserGamepadAxis.LeftStick,
        },
        {
          source: 'browserGamepad',
          kind: 'axis1d',
          action: InputActions.LocomotionTurn,
          axis: BrowserGamepadAxis.RightStick,
          component: 'x',
        },
        {
          source: 'browserGamepad',
          kind: 'button',
          action: InputActions.LocomotionJump,
          button: BrowserGamepadButton.South,
        },
      );
    }

    return bindings;
  }
}

function cloneBinding(binding: InputActionBinding): InputActionBinding {
  if (binding.source === 'keyboard' && binding.kind === 'axis2d') {
    return {
      ...binding,
      negativeX: binding.negativeX ? [...binding.negativeX] : undefined,
      positiveX: binding.positiveX ? [...binding.positiveX] : undefined,
      negativeY: binding.negativeY ? [...binding.negativeY] : undefined,
      positiveY: binding.positiveY ? [...binding.positiveY] : undefined,
    };
  }

  return { ...binding };
}

function bindingsEqual(
  first: InputActionBinding,
  second: InputActionBinding,
): boolean {
  return bindingKey(first) === bindingKey(second);
}

function bindingKey(binding: InputActionBinding): string {
  const entries = Object.entries(binding).map(([key, value]) => [
    key,
    Array.isArray(value) ? [...value].sort() : value,
  ]);
  entries.sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
  return JSON.stringify(entries);
}
