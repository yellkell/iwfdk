/**
 * Copyright (c) IWFDK contributors.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isSteamFrameBrowser, VALVE_FRAME_PROFILE_ID } from '@iwsdk/xr-input';

/**
 * WebXR rendering workarounds for Chromium on the Valve Steam Frame (see
 * FRAME.md, "Making a WebXR app great on the Steam Frame"). Each one is
 * limited to a Steam Frame browser, so other browsers behave as in IWSDK.
 */

/**
 * Whether WebXR Layers must be avoided. Chromium's Linux OpenXR backend lets
 * Blink offer the `layers` feature and `XRWebGLBinding.createProjectionLayer`,
 * but its Vulkan graphics binding cannot composite layers
 * (`SupportsLayers()` is false), so a page rendering into a projection layer
 * shows black in the headset. Chromium XR's launcher turns layers off
 * (`--disable-blink-features=WebXRLayers`); other Frame builds don't.
 */
export function avoidsWebXRLayers(): boolean {
  return isSteamFrameBrowser();
}

/**
 * Run `setSession` so three.js renders through an `XRWebGLLayer` rather than a
 * projection layer. three.js picks a projection layer whenever
 * `XRWebGLBinding.prototype.createProjectionLayer` exists, whatever features
 * the session has, so on a Steam Frame browser the method is hidden while
 * `run` sets the session up and restored afterwards: the page then renders as
 * it would with `--disable-blink-features=WebXRLayers`.
 */
export async function withoutProjectionLayers<T>(
  run: () => Promise<T>,
): Promise<T> {
  const proto = (
    globalThis as { XRWebGLBinding?: { prototype: Record<string, unknown> } }
  ).XRWebGLBinding?.prototype;
  const descriptor =
    proto && avoidsWebXRLayers()
      ? Object.getOwnPropertyDescriptor(proto, 'createProjectionLayer')
      : undefined;
  if (!proto || !descriptor?.configurable) {
    return run();
  }
  delete proto.createProjectionLayer;
  try {
    return await run();
  } finally {
    Object.defineProperty(proto, 'createProjectionLayer', descriptor);
  }
}

/**
 * When to call `gl.finish()` at the end of each XR frame:
 * - `'auto'`: only in a Steam Frame browser without Chromium XR's fix;
 * - `true` / `false`: always / never while in XR.
 */
export type FinishXRFramesOption = boolean | 'auto';

let valveFrameSeen = false;

/**
 * Whether this XR frame should end with `gl.finish()`.
 *
 * Chromium's `XRWebGLDrawingBuffer` discards the depth and stencil
 * attachments (`DiscardFramebufferEXT`) when it hands a frame to the
 * compositor. On the Frame's graphics stack (ANGLE on GL on zink on Turnip)
 * that breaks the frame: the right eye goes black or flickers and effects
 * such as water disappear. Chromium XR skips the discard (FramePlayer
 * Chromium patch 0005); in other Frame builds, finishing the frame before it
 * is handed over avoids it (verified on a Frame; a finish after the discard
 * does not help). A finish stalls the CPU until the GPU is done, so `'auto'`
 * applies it only where it is needed: on a Steam Frame browser until a
 * controller reports `valve-frame`, as Chromium XR's do (the community
 * builds without the IWFDK patches report Touch controllers).
 */
export function shouldFinishXRFrame(
  option: FinishXRFramesOption,
  session: XRSession | undefined,
): boolean {
  if (!session) {
    return false;
  }
  if (option !== 'auto') {
    return option;
  }
  if (valveFrameSeen || !isSteamFrameBrowser()) {
    return false;
  }
  for (const source of session.inputSources ?? []) {
    if (source.profiles?.includes(VALVE_FRAME_PROFILE_ID)) {
      valveFrameSeen = true;
      return false;
    }
  }
  return true;
}

/** @internal Clears what {@link shouldFinishXRFrame} has learned (tests). */
export function resetSteamFrameRenderingForTests(): void {
  valveFrameSeen = false;
}
