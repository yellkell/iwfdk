/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import {
  FloatType,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from '../../runtime/three.js';
import { DepthPreprocessingShader } from './preprocessing-shader.glsl.js';

/**
 * Depth preprocessing pass — ported from Meta SDK DepthPreprocessing.shader.
 *
 * Runs a single fullscreen pass on the raw XR depth texture at depth texture
 * resolution (~256×192). For each output texel it samples a 4×4 neighborhood
 * and computes min/max/avg depth, writing the result to an RGBA float target:
 *
 *   RGBA = (minAvg, maxAvg, avg - minAvg, maxAvg - minAvg)  in meters
 *
 * The material shader then samples this preprocessed texture to apply soft
 * occlusion without requiring scene-override renders or Kawase blur.
 */
export class DepthPreprocessingPass {
  private material: ShaderMaterial;
  private renderTargets: [WebGLRenderTarget, WebGLRenderTarget];
  private fsQuad: FullScreenQuad;

  constructor() {
    this.material = new ShaderMaterial({
      name: 'DepthPreprocessing',
      uniforms: {
        uXRDepthTextureArray: { value: null },
        uRawValueToMeters: { value: 0.001 },
        uViewId: { value: 0 },
        uDepthTextureSize: { value: new Vector2() },
        uIsGPUDepth: { value: false },
        uDepthNear: { value: 0 },
      },
      vertexShader: DepthPreprocessingShader.vertexShader,
      fragmentShader: DepthPreprocessingShader.fragmentShader,
    });

    const rtOptions = { format: RGBAFormat, type: FloatType };
    this.renderTargets = [
      new WebGLRenderTarget(1, 1, rtOptions),
      new WebGLRenderTarget(1, 1, rtOptions),
    ];

    this.fsQuad = new FullScreenQuad(this.material);
  }

  /**
   * Set the depth texture source for preprocessing.
   * @param depthTexture - The XR depth texture array (ExternalTexture or DataArrayTexture).
   * @param rawValueToMeters - Conversion factor from raw depth values to meters.
   * @param isGPUDepth - Whether the depth data is GPU-optimized (inverse depth).
   * @param depthNear - The near plane distance for GPU depth conversion.
   */
  setDepthTexture(
    depthTexture: Texture,
    rawValueToMeters: number,
    isGPUDepth: boolean,
    depthNear: number,
  ): void {
    this.material.uniforms.uXRDepthTextureArray.value = depthTexture;
    this.material.uniforms.uRawValueToMeters.value = rawValueToMeters;
    this.material.uniforms.uIsGPUDepth.value = isGPUDepth;
    this.material.uniforms.uDepthNear.value = depthNear;
  }

  /**
   * Render the preprocessing pass.
   * @param renderer - The three.js WebGL renderer.
   * @param depthWidth - Width of the depth texture.
   * @param depthHeight - Height of the depth texture.
   * @param viewId - The view index to render (default 0).
   */
  render(
    renderer: WebGLRenderer,
    depthWidth: number,
    depthHeight: number,
    viewId = 0,
  ): void {
    const target = this.renderTargets[viewId];
    // Only resize if dimensions actually changed
    if (target.width !== depthWidth || target.height !== depthHeight) {
      target.setSize(depthWidth, depthHeight);
    }
    this.material.uniforms.uViewId.value = viewId;
    (this.material.uniforms.uDepthTextureSize.value as Vector2).set(
      depthWidth,
      depthHeight,
    );

    const originalRenderTarget = renderer.getRenderTarget();
    // Temporarily disable XR so FullScreenQuad renders with its own
    // identity camera instead of the XR stereo/multiview cameras.
    const xrEnabled = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    this.fsQuad.render(renderer);
    renderer.setRenderTarget(originalRenderTarget);
    renderer.xr.enabled = xrEnabled;
  }

  /**
   * Get the preprocessed depth texture for a given view.
   * RGBA = (minAvg, maxAvg, avg - minAvg, maxAvg - minAvg) in meters.
   * @param viewId - The view index (0 for left eye, 1 for right eye).
   */
  getTexture(viewId = 0): Texture {
    return this.renderTargets[viewId].texture;
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    for (const target of this.renderTargets) {
      target.dispose();
    }
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
