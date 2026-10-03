/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  Group,
  Object3D,
  PerspectiveCamera,
  PropertyBinding,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import {
  getProfile as getGeneratedProfile,
  PROFILES_LIST,
} from '../gamepad/generated-profiles.js';
import {
  DEFAULT_PROFILES_PATH,
  registerInputProfile,
  type InputLayout,
  type InputProfile,
} from '../gamepad/input-profiles.js';
import { VALVE_FRAME_PROFILE } from '../gamepad/profiles/valve-frame.js';
import type { VisualConstructor } from '../visual/adapter/base-visual-adapter.js';
import { BaseControllerVisual } from '../visual/impl/base-impl.js';
import {
  FRAME_EMULATION_PROFILE_IDS,
  isSteamFrameBrowser,
} from './platform.js';

/**
 * Real Steam Frame controller models, extracted from SteamVR with
 * `tools/frame-models` (see FRAME.md). The OpenXR runtime animates its render
 * models by reporting node poses (XR_EXT_render_model), which a WebXR page
 * cannot ask for; the extraction tool records how each node follows the
 * input, and {@link FrameControllerVisual} replays that from gamepad values.
 */
export const FRAME_MODELS_FORMAT = 'iwfdk-frame-controller-models';
export const FRAME_MODELS_VERSION = 1;
export const FRAME_MODELS_FILE = 'frame-controller-models.json';

export interface FramePose {
  position: [number, number, number];
  /** Quaternion `[x, y, z, w]`. */
  orientation: [number, number, number, number];
}

export type FrameModelProperty = 'value' | 'pressed' | 'touched' | 'x' | 'y';

export type FrameModelAnimation =
  | {
      kind: 'button';
      node: string;
      component: string;
      property: FrameModelProperty;
      rest: FramePose;
      pressed: FramePose;
      confidence: number;
    }
  | {
      kind: 'stick';
      node: string;
      component: string;
      rest: FramePose;
      /** Full deflection per direction; `up` is the stick pushed forward. */
      left?: FramePose | null;
      right?: FramePose | null;
      up?: FramePose | null;
      down?: FramePose | null;
      confidence: number;
    }
  | {
      kind: 'visibility';
      node: string;
      component: string;
      property: FrameModelProperty;
      visibleWhenActive: boolean;
      confidence: number;
    };

export interface FrameHandModel {
  /** GLB file name, relative to the models directory. */
  asset: string;
  nodeNames: string[];
  animations: FrameModelAnimation[];
  visibleAtRest: Record<string, boolean>;
  unmappedNodes: string[];
  /** Model origin in the grip space. */
  gripFromModel?: FramePose | null;
  gripFromModelSpread?: number | null;
  restSamples: number;
  missingCoverage: string[];
}

export interface FrameControllerModels {
  format: typeof FRAME_MODELS_FORMAT;
  version: number;
  runtime: { name: string; version: string };
  hands: Partial<Record<'left' | 'right', FrameHandModel>>;
}

/** An input layout carrying the hand's model calibration. */
export type FrameModelLayout = InputLayout & { frameModel?: FrameHandModel };

export function parseFrameControllerModels(
  json: unknown,
): FrameControllerModels {
  const m = json as Partial<FrameControllerModels> | null;
  if (!m || m.format !== FRAME_MODELS_FORMAT) {
    throw new Error(`Not a ${FRAME_MODELS_FILE} file`);
  }
  if (m.version !== FRAME_MODELS_VERSION) {
    throw new Error(
      `Unsupported ${FRAME_MODELS_FILE} version ${m.version}; re-run tools/frame-models`,
    );
  }
  if (!m.hands || (!m.hands.left && !m.hands.right)) {
    throw new Error(`${FRAME_MODELS_FILE} has no controller models`);
  }
  return m as FrameControllerModels;
}

/**
 * The valve-frame profile with the real models: each layout with a model
 * names its GLB (relative to the models directory) and carries its
 * calibration, and its per-component visual responses are dropped because
 * {@link FrameControllerVisual} animates the runtime's own nodes. A hand
 * without a model keeps the generic layout.
 */
export function frameProfileWithModels(
  models: FrameControllerModels,
): InputProfile {
  const layouts: InputProfile['layouts'] = {};
  for (const hand of ['left', 'right'] as const) {
    const layout = VALVE_FRAME_PROFILE.layouts[hand];
    const model = models.hands[hand];
    if (!layout) {
      continue;
    }
    if (!model) {
      layouts[hand] = layout;
      continue;
    }
    const components: InputLayout['components'] = {};
    for (const [id, config] of Object.entries(layout.components)) {
      components[id] = { ...config, visualResponses: {} };
    }
    const withModel: FrameModelLayout = {
      ...layout,
      components,
      rootNodeName: '',
      assetPath: model.asset,
      frameModel: model,
    };
    layouts[hand] = withModel;
  }
  return { ...VALVE_FRAME_PROFILE, layouts };
}

/**
 * `profileId` (a profile SteamVR's Touch emulation reports for the Frame
 * controllers) with the real Frame models: the layouts keep the emulated
 * profile's gamepad indices, so only components the emulation exposes under
 * the same name (trigger, grip, thumbstick, A and B) animate. A hand without
 * a model keeps the profile's own model.
 */
export function frameEmulationProfileWithModels(
  models: FrameControllerModels,
  profileId: string,
): InputProfile {
  const entry = PROFILES_LIST[profileId];
  if (!entry) {
    throw new Error(`Unknown input profile ${profileId}`);
  }
  const base = getGeneratedProfile(entry.path) as InputProfile;
  const layouts: InputProfile['layouts'] = {};
  for (const [hand, layout] of Object.entries(base.layouts) as [
    XRHandedness,
    InputLayout,
  ][]) {
    const model = hand === 'none' ? undefined : models.hands[hand];
    if (!model) {
      // Absolute, so the models directory does not capture it.
      layouts[hand] = {
        ...layout,
        assetPath: `${DEFAULT_PROFILES_PATH}/${profileId}/${layout.assetPath}`,
      };
      continue;
    }
    const components: InputLayout['components'] = {};
    for (const [id, config] of Object.entries(layout.components)) {
      components[id] = { ...config, visualResponses: {} };
    }
    const withModel: FrameModelLayout = {
      ...layout,
      components,
      rootNodeName: '',
      assetPath: model.asset,
      frameModel: model,
    };
    layouts[hand] = withModel;
  }
  return { ...base, layouts };
}

export interface FrameControllerModelOptions {
  /**
   * Also show the models when the controllers are reported through
   * SteamVR's Touch emulation (a Frame browser without the IWFDK Chromium
   * patch). Defaults to {@link isSteamFrameBrowser}.
   */
  emulation?: boolean;
}

/**
 * Use `models`, served from `baseUrl` (absolute, or relative to the page),
 * for the Frame controllers connected from now on.
 */
export function registerFrameControllerModels(
  models: FrameControllerModels,
  baseUrl: string,
  { emulation = isSteamFrameBrowser() }: FrameControllerModelOptions = {},
): void {
  const options = {
    assetBasePath: baseUrl.replace(/\/+$/, '') || '.',
    selectVisualClass: (layout: InputLayout) =>
      (layout as FrameModelLayout).frameModel
        ? (FrameControllerVisual as unknown as VisualConstructor<FrameControllerVisual>)
        : undefined,
  };
  registerInputProfile(frameProfileWithModels(models), options);
  if (emulation) {
    for (const id of FRAME_EMULATION_PROFILE_IDS) {
      registerInputProfile(
        frameEmulationProfileWithModels(models, id),
        options,
      );
    }
  }
}

/**
 * Fetch extracted Frame controller models from `baseUrl` (the directory
 * holding `frame-controller-models.json`, `left.glb` and `right.glb`,
 * absolute or relative to the page) and use them for the Frame controllers
 * connected from now on: `valve-frame` controllers, and on a Steam Frame
 * browser also controllers reported through SteamVR's Touch emulation. Controllers already connected switch on
 * their next connection.
 */
export async function loadFrameControllerModels(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: FrameControllerModelOptions = {},
): Promise<FrameControllerModels> {
  const base = baseUrl.replace(/\/+$/, '') || '.';
  const url = `${base}/${FRAME_MODELS_FILE}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  const models = parseFrameControllerModels(await response.json());
  registerFrameControllerModels(models, base, options);
  return models;
}

type Bound =
  | {
      kind: 'button';
      node: Object3D;
      index: number;
      property: FrameModelProperty;
      rest: { p: Vector3; q: Quaternion };
      pressed: { p: Vector3; q: Quaternion };
    }
  | {
      kind: 'stick';
      node: Object3D;
      xAxis: number;
      yAxis: number;
      rest: { p: Vector3; q: Quaternion };
      /** Per direction: offset from rest (translation, rotation). */
      deltas: Record<
        'left' | 'right' | 'up' | 'down',
        { p: Vector3; q: Quaternion } | undefined
      >;
    }
  | {
      kind: 'visibility';
      node: Object3D;
      index?: number;
      axis?: number;
      property: FrameModelProperty;
      visibleWhenActive: boolean;
    };

function toThree(pose: FramePose) {
  return {
    p: new Vector3(...pose.position),
    q: new Quaternion(...pose.orientation).normalize(),
  };
}

const IDENTITY = new Quaternion();
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpV = new Vector3();

/**
 * Animates a real Frame controller model from WebXR gamepad values using the
 * calibration recorded by `tools/frame-models`. Registered for the
 * `valve-frame` profile by {@link loadFrameControllerModels}.
 */
export class FrameControllerVisual extends BaseControllerVisual {
  static assetKeyPrefix = 'frame-controller-';
  private bound: Bound[] = [];

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    gltfScene: Group,
    layout: InputLayout,
  ) {
    super(scene, camera, gltfScene, layout);
  }

  init() {
    const model = (this.layout as FrameModelLayout).frameModel;
    const asset = this.model;
    // The adapter places `model` at the grip pose; the runtime model's
    // origin sits at `gripFromModel` within it.
    const root = new Group();
    root.name = 'frame-controller';
    root.add(asset);
    if (model?.gripFromModel) {
      const { p, q } = toThree(model.gripFromModel);
      asset.position.copy(p);
      asset.quaternion.copy(q);
    }
    this.model = root;
    if (!model) {
      return;
    }

    // GLTFLoader sanitizes node names and suffixes duplicates, keeping the
    // original in userData.name.
    const find = (name: string) => {
      let found: Object3D | undefined;
      asset.traverse((o) => {
        if (!found && o.userData?.name === name) {
          found = o;
        }
      });
      return (
        found ??
        asset.getObjectByName(PropertyBinding.sanitizeNodeName(name)) ??
        asset.getObjectByName(name)
      );
    };
    for (const [name, visible] of Object.entries(model.visibleAtRest)) {
      const node = find(name);
      if (node) {
        node.visible = visible;
      }
    }

    const components = this.layout.components;
    for (const animation of model.animations) {
      const node = find(animation.node);
      const indices = components[animation.component]?.gamepadIndices;
      if (!node || !indices) {
        continue;
      }
      if (
        animation.kind === 'button' &&
        indices.button !== undefined &&
        animation.property !== 'x' &&
        animation.property !== 'y'
      ) {
        this.bound.push({
          kind: 'button',
          node,
          index: indices.button,
          property: animation.property,
          rest: toThree(animation.rest),
          pressed: toThree(animation.pressed),
        });
      } else if (
        animation.kind === 'stick' &&
        indices.xAxis !== undefined &&
        indices.yAxis !== undefined
      ) {
        const rest = toThree(animation.rest);
        const restInverse = rest.q.clone().invert();
        const delta = (pose?: FramePose | null) => {
          if (!pose) {
            return undefined;
          }
          const full = toThree(pose);
          return {
            p: full.p.sub(rest.p),
            q: restInverse.clone().multiply(full.q),
          };
        };
        const deltas = {
          left: delta(animation.left),
          right: delta(animation.right),
          up: delta(animation.up),
          down: delta(animation.down),
        };
        // A direction never reached during capture mirrors its opposite.
        const mirror = (d?: { p: Vector3; q: Quaternion }) =>
          d && { p: d.p.clone().negate(), q: d.q.clone().invert() };
        deltas.left ??= mirror(deltas.right);
        deltas.right ??= mirror(deltas.left);
        deltas.up ??= mirror(deltas.down);
        deltas.down ??= mirror(deltas.up);
        this.bound.push({
          kind: 'stick',
          node,
          xAxis: indices.xAxis,
          yAxis: indices.yAxis,
          rest,
          deltas,
        });
      } else if (animation.kind === 'visibility') {
        const axis =
          animation.property === 'x'
            ? indices.xAxis
            : animation.property === 'y'
              ? indices.yAxis
              : undefined;
        const isAxis = animation.property === 'x' || animation.property === 'y';
        if (isAxis ? axis === undefined : indices.button === undefined) {
          continue;
        }
        this.bound.push({
          kind: 'visibility',
          node,
          index: isAxis ? undefined : indices.button,
          axis,
          property: animation.property,
          visibleWhenActive: animation.visibleWhenActive,
        });
      }
    }
  }

  update() {
    const gamepad = this.gamepad;
    if (!this.enabled || !gamepad) {
      return;
    }
    for (const b of this.bound) {
      if (b.kind === 'button') {
        const button = gamepad.buttons[b.index];
        const v =
          b.property === 'pressed'
            ? button?.pressed
              ? 1
              : 0
            : b.property === 'touched'
              ? button?.touched
                ? 1
                : 0
              : (button?.value ?? 0);
        b.node.position.lerpVectors(b.rest.p, b.pressed.p, v);
        b.node.quaternion.slerpQuaternions(b.rest.q, b.pressed.q, v);
      } else if (b.kind === 'stick') {
        const x = gamepad.axes[b.xAxis] ?? 0;
        // Gamepad y is positive down (toward the user); OpenXR's, used by
        // the capture, is positive forward.
        const y = -(gamepad.axes[b.yAxis] ?? 0);
        const dx = x >= 0 ? b.deltas.right : b.deltas.left;
        const dy = y >= 0 ? b.deltas.up : b.deltas.down;
        tmpV.copy(b.rest.p);
        tmpQ.copy(b.rest.q);
        if (dx) {
          tmpV.addScaledVector(dx.p, Math.abs(x));
          tmpQ.multiply(tmpQ2.slerpQuaternions(IDENTITY, dx.q, Math.abs(x)));
        }
        if (dy) {
          tmpV.addScaledVector(dy.p, Math.abs(y));
          tmpQ.multiply(tmpQ2.slerpQuaternions(IDENTITY, dy.q, Math.abs(y)));
        }
        b.node.position.copy(tmpV);
        b.node.quaternion.copy(tmpQ);
      } else {
        let active = false;
        if (b.axis !== undefined) {
          active = Math.abs(gamepad.axes[b.axis] ?? 0) > 0.5;
        } else if (b.index !== undefined) {
          const button = gamepad.buttons[b.index];
          active =
            b.property === 'touched'
              ? !!button?.touched
              : b.property === 'pressed'
                ? !!button?.pressed
                : (button?.value ?? 0) > 0.5;
        }
        b.node.visible = b.visibleWhenActive ? active : !active;
      }
    }
  }
}
