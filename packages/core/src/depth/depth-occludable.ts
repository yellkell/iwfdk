/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent } from '../ecs/component.js';
/** Occlusion shader mode for {@link DepthOccludable}. @category Depth Sensing */
export const OcclusionShadersMode = {
  /** Soft occlusion with 13-tap blur sampling for smooth edges. */
  SoftOcclusion: 'SoftOcclusion',
  /** Hard occlusion with a single depth sample per fragment. */
  HardOcclusion: 'HardOcclusion',
  /** MinMax soft occlusion with depth preprocessing for edge-aware smooth edges. */
  MinMaxSoftOcclusion: 'MinMaxSoftOcclusion',
};

/**
 * Component for entities that should be occluded by real-world depth.
 * Add this component to entities that should be hidden when behind real-world surfaces.
 * NOTE: The depth occlusion feature may not be compatible with custom shaders.
 *
 * @example
 * ```ts
 * // Create an entity with soft occlusion (default)
 * const entity = world.createTransformEntity(mesh);
 * entity.addComponent(DepthOccludable);
 *
 * // Create an entity with hard occlusion (no blur)
 * entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
 * ```
 *
 * @category Depth Sensing
 */
export const DepthOccludable = createComponent(
  'DepthOccludable',
  {
    mode: {
      type: Types.Enum,
      enum: OcclusionShadersMode,
      default: OcclusionShadersMode.SoftOcclusion,
    },
  },
  'Entity that can be occluded by real-world depth',
);
