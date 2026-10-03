/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';
/**
 * Ray source options for environment raycasting.
 * @category Environment Raycast
 */
export const RaycastSpace = {
  /** Use left controller's target ray */
  Left: 'left',
  /** Use right controller's target ray */
  Right: 'right',
  /** Use viewer/head position and gaze direction */
  Viewer: 'viewer',
  /** For phone AR - tracks screen touch for tap-to-place */
  Screen: 'screen',
} as const;

export type RaycastSpace = (typeof RaycastSpace)[keyof typeof RaycastSpace];

/**
 * Component that makes an entity follow environment raycast hit points.
 *
 * @remarks
 * The entity's Object3D is automatically positioned at the raycast hit point
 * and oriented to match the surface normal. When there's no hit, the Object3D
 * is hidden.
 *
 * Use `offsetPosition` and `offsetQuaternion` to offset the ray from the
 * space origin. This is useful for one-shot raycasts where you want to
 * cast from a specific position/orientation relative to the controller.
 *
 * @example Teleport reticle that follows controller ray
 * ```ts
 * const reticle = world.createTransformEntity(reticleMesh);
 * reticle.addComponent(EnvironmentRaycastTarget, { space: RaycastSpace.Right });
 * // Reticle automatically moves to where controller points
 * ```
 *
 * @example Place object on trigger press
 * ```ts
 * const xrResult = entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult');
 * if (xrResult && gamepad.getSelectStart()) {
 *   spawnObject(entity.object3D.position.clone());
 * }
 * ```
 *
 * @category Environment Raycast
 */
export const EnvironmentRaycastTarget = createComponent(
  'EnvironmentRaycastTarget',
  {
    /** Ray source: 'left', 'right', 'viewer', or 'screen'. @default 'right' */
    space: {
      type: Types.Enum,
      enum: RaycastSpace,
      default: RaycastSpace.Right,
    },
    /** Maximum raycast distance in meters. @default 100 */
    maxDistance: { type: Types.Float32, default: 100 },

    /** Offset position from the space origin. @default (0, 0, 0) */
    offsetPosition: { type: Types.Object, default: undefined },
    /** Offset quaternion to rotate the ray direction. @default identity */
    offsetQuaternion: { type: Types.Object, default: undefined },

    /** The XRHitTestResult when there's a hit, undefined otherwise. @readonly */
    xrHitTestResult: { type: Types.Object, default: undefined },
    /** For Screen mode: the input source that triggered the hit. @readonly */
    inputSource: { type: Types.Object, default: undefined },

    /** @internal */
    _source: { type: Types.Object, default: undefined },
    /** @internal */
    _raySpace: { type: Types.Object, default: undefined },
    /** @internal */
    _transientSource: { type: Types.Object, default: undefined },
    /** @internal */
    _sourceRequested: { type: Types.Boolean, default: false },
  },
  'Entity follows environment raycast hit points',
);
