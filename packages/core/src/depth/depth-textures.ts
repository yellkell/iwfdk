/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  DataArrayTexture,
  ExternalTexture,
  FloatType,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  WebGLRenderer,
} from '../runtime/three.js';
/**
 * Manages depth textures from WebXR depth sensing.
 * Supports both CPU-optimized (DataArrayTexture) and GPU-optimized (ExternalTexture) depth data.
 */
export class DepthTextures {
  private nativeTexture?: ExternalTexture;
  private dataArrayTexture?: DataArrayTexture;
  private combinedArray?: Float32Array | Uint8Array;

  constructor(private useFloat32: boolean) {}

  /**
   * Create or recreate the DataArrayTexture for stereo CPU depth.
   * Packs per-view depth data into a single texture array (depth=2)
   * so the shader can select the correct layer via VIEW_ID.
   */
  private createDataArrayTexture(width: number, height: number): void {
    if (this.dataArrayTexture) {
      this.dataArrayTexture.dispose();
    }
    const depth = 2; // stereo: left + right eye
    if (this.useFloat32) {
      const pixelsPerLayer = width * height;
      this.combinedArray = new Float32Array(pixelsPerLayer * depth);
      this.dataArrayTexture = new DataArrayTexture(
        this.combinedArray,
        width,
        height,
        depth,
      );
      this.dataArrayTexture.format = RedFormat;
      this.dataArrayTexture.type = FloatType;
    } else {
      const bytesPerLayer = width * height * 2;
      this.combinedArray = new Uint8Array(bytesPerLayer * depth);
      this.dataArrayTexture = new DataArrayTexture(
        this.combinedArray,
        width,
        height,
        depth,
      );
      this.dataArrayTexture.format = RGFormat;
      this.dataArrayTexture.type = UnsignedByteType;
    }
  }

  /**
   * Update the depth texture with new CPU depth data.
   * Copies per-view data into the correct layer of the DataArrayTexture.
   * @param depthData - The CPU depth information from WebXR.
   * @param viewId - The view index (0 for left eye, 1 for right eye).
   */
  updateData(depthData: XRCPUDepthInformation, viewId: number): void {
    // Recreate the DataArrayTexture if dimensions changed or it doesn't exist
    if (
      !this.dataArrayTexture ||
      this.dataArrayTexture.image.width !== depthData.width ||
      this.dataArrayTexture.image.height !== depthData.height
    ) {
      this.createDataArrayTexture(depthData.width, depthData.height);
    }

    if (this.useFloat32) {
      const viewData = new Float32Array(depthData.data);
      const layerSize = depthData.width * depthData.height;
      (this.combinedArray as Float32Array).set(viewData, viewId * layerSize);
    } else {
      const viewData = new Uint8Array(depthData.data);
      const layerSize = depthData.width * depthData.height * 2;
      (this.combinedArray as Uint8Array).set(viewData, viewId * layerSize);
    }

    this.dataArrayTexture!.addLayerUpdate(viewId);
    this.dataArrayTexture!.needsUpdate = true;
  }

  /**
   * Update the depth texture with native GPU texture from WebXR.
   * The native texture is a texture array containing both eyes' depth data.
   * @param depthData - The GPU depth information from WebXR.
   * @param renderer - The WebGL renderer.
   */
  updateNativeTexture(
    depthData: XRWebGLDepthInformation,
    renderer: WebGLRenderer,
  ): void {
    if (!this.nativeTexture) {
      this.nativeTexture = new ExternalTexture(depthData.texture);
    } else {
      this.nativeTexture.sourceTexture = depthData.texture;
    }
    // Update the texture properties for three.js
    const textureProperties = renderer.properties.get(this.nativeTexture) as {
      __webglTexture: WebGLTexture;
      __version: number;
    };
    textureProperties.__webglTexture = depthData.texture;
    textureProperties.__version = 1;
  }

  /**
   * Get the native GPU depth texture array.
   * Contains both eyes' depth data; the shader uses VIEW_ID to select the layer.
   */
  getNativeTexture(): ExternalTexture | undefined {
    return this.nativeTexture;
  }

  /**
   * Get the CPU depth data as a DataArrayTexture.
   * Contains per-view depth packed into layers; the shader uses VIEW_ID to select the layer.
   */
  getDataArrayTexture(): DataArrayTexture | undefined {
    return this.dataArrayTexture;
  }

  /**
   * Dispose of all depth textures.
   */
  dispose(): void {
    this.dataArrayTexture?.dispose();
    this.dataArrayTexture = undefined;
    this.combinedArray = undefined;
    this.nativeTexture = undefined;
  }
}
