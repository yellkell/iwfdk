/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Real Steam Frame controller models for three.js WebXR apps. The models are
// the ones SteamVR serves on a Frame, extracted with IWFDK's tools/frame-models
// along with how each part moves (FRAME.md section 4). Needs `three` and
// `three/addons/` (an import map or a bundler).

import { Group, PropertyBinding, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  LAYOUTS,
  STICK_AXES,
  VALVE_FRAME,
  isSteamFrame,
} from './steam-frame.js';

/**
 * IWFDK's extraction, from a fixed tag on GitHub's raw host (CORS-enabled;
 * jsDelivr refuses this repository for size). Copy the directory to self-host.
 */
export const FRAME_MODELS_URL =
  'https://raw.githubusercontent.com/yellkell/iwfdk/frame-models-1/packages/xr-input/frame-models';

// The extraction names components after the valve-frame WebXR profile.
const COMPONENT = {
  'xr-standard-trigger': 'trigger',
  'xr-standard-squeeze': 'squeeze',
  'xr-standard-thumbstick': 'thumbstick',
  shoulder: 'shoulder',
  'dpad-up': 'dpadUp',
  'dpad-down': 'dpadDown',
  'dpad-left': 'dpadLeft',
  'dpad-right': 'dpadRight',
  'a-button': 'a',
  'b-button': 'b',
  'x-button': 'x',
  'y-button': 'y',
  menu: 'menu',
  view: 'view',
};

const pose = (p) => ({
  p: new Vector3(...p.position),
  q: new Quaternion(...p.orientation).normalize(),
});
const IDENTITY = new Quaternion();
const tq = new Quaternion();
const tq2 = new Quaternion();
const tv = new Vector3();

/** Whether `source` is a Frame controller: `valve-frame`, or Touch emulation on a Frame. */
export function isFrameController(source, { emulation = isSteamFrame() } = {}) {
  const id = source?.profiles?.[0];
  return id === VALVE_FRAME || (emulation && !!id?.startsWith('oculus-touch'));
}

/**
 * Shows the Frame controller models on `renderer.xr`'s controller grips
 * whenever Frame controllers connect, and animates them from the gamepad.
 * Call `update()` once per frame. For other controllers it does nothing, so
 * keep the app's own models (e.g. XRControllerModelFactory) on the grips:
 * while a Frame controller is connected they are hidden (`hideOtherModels`).
 */
export class FrameControllerModels {
  constructor(
    renderer,
    {
      url = FRAME_MODELS_URL,
      emulation = isSteamFrame(),
      loader = new GLTFLoader(),
      hideOtherModels = true,
    } = {},
  ) {
    this.hideOtherModels = hideOtherModels;
    this.base = url.replace(/\/+$/, '');
    this.emulation = emulation;
    this.loader = loader;
    this.hands = [];
    this.manifest = undefined;
    for (let i = 0; i < 2; i++) {
      const grip = renderer.xr.getControllerGrip(i);
      const hand = {
        grip,
        source: undefined,
        root: undefined,
        bound: [],
        token: 0,
        hidden: [],
      };
      this.hands.push(hand);
      grip.addEventListener('connected', (e) => this.#connect(hand, e.data));
      grip.addEventListener('disconnected', () => this.#disconnect(hand));
    }
  }

  async #manifest() {
    this.manifest ??= fetch(`${this.base}/frame-controller-models.json`).then(
      (r) => {
        if (!r.ok)
          throw new Error(`Frame controller models: ${r.status} ${r.url}`);
        return r.json();
      },
    );
    return this.manifest;
  }

  async #connect(hand, source) {
    this.#disconnect(hand);
    if (!isFrameController(source, { emulation: this.emulation })) return;
    const token = ++hand.token;
    hand.source = source;
    const handedness = source.handedness;
    const data = (await this.#manifest()).hands?.[handedness];
    if (!data) return;
    const gltf = await this.loader.loadAsync(`${this.base}/${data.asset}`);
    if (token !== hand.token) return; // disconnected meanwhile
    const asset = gltf.scene;
    const root = new Group();
    root.name = 'frame-controller';
    root.add(asset);
    if (data.gripFromModel) {
      const { p, q } = pose(data.gripFromModel);
      asset.position.copy(p);
      asset.quaternion.copy(q);
    }
    hand.bound = this.#bind(asset, data, source);
    hand.root = root;
    if (this.hideOtherModels) {
      hand.hidden = hand.grip.children.filter((c) => c.visible);
      for (const c of hand.hidden) c.visible = false;
    }
    hand.grip.add(root);
  }

  #disconnect(hand) {
    hand.token++;
    hand.root?.removeFromParent();
    hand.root = undefined;
    for (const c of hand.hidden) c.visible = true;
    hand.hidden = [];
    hand.bound = [];
    hand.source = undefined;
  }

  #bind(asset, data, source) {
    const find = (name) => {
      let found;
      asset.traverse((o) => {
        if (!found && o.userData?.name === name) found = o;
      });
      return (
        found ??
        asset.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ??
        asset.getObjectByName(name)
      );
    };
    // SteamVR has been seen to report every node hidden at rest; only trust
    // the data when something shows.
    const rest = Object.values(data.visibleAtRest ?? {}).some(Boolean)
      ? data.visibleAtRest
      : {};
    for (const [name, visible] of Object.entries(rest)) {
      const node = find(name);
      if (node) node.visible = visible;
    }
    const layout = (
      source.profiles?.[0] === VALVE_FRAME
        ? LAYOUTS[VALVE_FRAME]
        : LAYOUTS.touch
    )[source.handedness];
    const bound = [];
    for (const a of data.animations ?? []) {
      const node = find(a.node);
      const index = layout[COMPONENT[a.component]];
      if (!node || index === undefined) continue;
      if (a.kind === 'button' && a.property !== 'x' && a.property !== 'y') {
        bound.push({
          kind: 'button',
          node,
          index,
          property: a.property,
          rest: pose(a.rest),
          pressed: pose(a.pressed),
        });
      } else if (a.kind === 'stick') {
        const r = pose(a.rest);
        const inv = r.q.clone().invert();
        const delta = (p) => {
          if (!p) return undefined;
          const full = pose(p);
          return { p: full.p.sub(r.p), q: inv.clone().multiply(full.q) };
        };
        const d = {
          left: delta(a.left),
          right: delta(a.right),
          up: delta(a.up),
          down: delta(a.down),
        };
        const mirror = (x) =>
          x && { p: x.p.clone().negate(), q: x.q.clone().invert() };
        d.left ??= mirror(d.right);
        d.right ??= mirror(d.left);
        d.up ??= mirror(d.down);
        d.down ??= mirror(d.up);
        bound.push({ kind: 'stick', node, rest: r, d });
      } else if (
        a.kind === 'visibility' &&
        a.property !== 'x' &&
        a.property !== 'y'
      ) {
        bound.push({
          kind: 'visibility',
          node,
          index,
          property: a.property,
          visibleWhenActive: a.visibleWhenActive,
        });
      }
    }
    return bound;
  }

  /** Animate buttons, triggers and sticks from the gamepads. */
  update() {
    for (const hand of this.hands) {
      const gamepad = hand.source?.gamepad;
      if (!gamepad || !hand.root) continue;
      for (const b of hand.bound) {
        if (b.kind === 'button') {
          const button = gamepad.buttons[b.index];
          const v =
            b.property === 'pressed'
              ? +!!button?.pressed
              : b.property === 'touched'
                ? +!!button?.touched
                : (button?.value ?? 0);
          b.node.position.lerpVectors(b.rest.p, b.pressed.p, v);
          b.node.quaternion.slerpQuaternions(b.rest.q, b.pressed.q, v);
        } else if (b.kind === 'stick') {
          const x = gamepad.axes[STICK_AXES.x] ?? 0;
          // Gamepad y is down-positive; the capture's "up" is the stick pushed forward.
          const y = -(gamepad.axes[STICK_AXES.y] ?? 0);
          const dx = x >= 0 ? b.d.right : b.d.left;
          const dy = y >= 0 ? b.d.up : b.d.down;
          tv.copy(b.rest.p);
          tq.copy(b.rest.q);
          if (dx) {
            tv.addScaledVector(dx.p, Math.abs(x));
            tq.multiply(tq2.slerpQuaternions(IDENTITY, dx.q, Math.abs(x)));
          }
          if (dy) {
            tv.addScaledVector(dy.p, Math.abs(y));
            tq.multiply(tq2.slerpQuaternions(IDENTITY, dy.q, Math.abs(y)));
          }
          b.node.position.copy(tv);
          b.node.quaternion.copy(tq);
        } else {
          const button = gamepad.buttons[b.index];
          const active =
            b.property === 'touched'
              ? !!button?.touched
              : b.property === 'pressed'
                ? !!button?.pressed
                : (button?.value ?? 0) > 0.5;
          b.node.visible = b.visibleWhenActive ? active : !active;
        }
      }
    }
  }
}
