/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrowserCameraSnapshot,
  attachBrowserCameraRestore,
  snapshotBrowserCamera,
} from '../../src/init/browser-camera.js';
import { Group, PerspectiveCamera } from '../../src/runtime/index.js';

class FakeXRSession {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();

  addEventListener(type: string, fn: (...args: any[]) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
  }

  removeEventListener(type: string, fn: (...args: any[]) => void): void {
    this.listeners.get(type)?.delete(fn);
  }

  dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) {
      fn();
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

describe('browser-camera snapshot/restore', () => {
  let pendingRaf: Array<() => void>;

  beforeEach(() => {
    pendingRaf = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      pendingRaf.push(cb);
      return pendingRaf.length;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const flushRaf = () => {
    const queue = pendingRaf;
    pendingRaf = [];
    for (const cb of queue) {
      cb();
    }
  };

  it('captures and restores local transform and projection', () => {
    const camera = new PerspectiveCamera(45, 16 / 9, 0.05, 150);
    camera.position.set(1.25, 1.7, -3.5);
    camera.lookAt(0, 1, 0);
    camera.zoom = 1.4;
    camera.updateProjectionMatrix();
    const snap = snapshotBrowserCamera(camera);

    // XR-style mutation
    camera.position.set(0, 0, 0);
    camera.quaternion.set(0, 0, 0, 1);
    camera.fov = 90;
    camera.aspect = 1;
    camera.near = 1;
    camera.far = 1000;
    camera.zoom = 0.5;
    camera.updateProjectionMatrix();

    applyBrowserCameraSnapshot(camera, snap);

    expect(camera.position.toArray()).toEqual(snap.position.toArray());
    expect(camera.quaternion.toArray()).toEqual(snap.quaternion.toArray());
    expect(camera.scale.toArray()).toEqual(snap.scale.toArray());
    expect(camera.fov).toBe(snap.fov);
    expect(camera.aspect).toBe(snap.aspect);
    expect(camera.near).toBe(snap.near);
    expect(camera.far).toBe(snap.far);
    expect(camera.zoom).toBe(snap.zoom);
  });

  it('attachBrowserCameraRestore defers restore one rAF after session end', () => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(2, 1.6, 4);
    camera.lookAt(0, 0, 0);
    const beforePos = camera.position.toArray();
    const beforeQuat = camera.quaternion.toArray();
    const beforeFov = camera.fov;

    const session = new FakeXRSession();
    attachBrowserCameraRestore(camera, session as unknown as XRSession);
    expect(session.listenerCount('end')).toBe(1);

    // Simulate three.js's WebXRManager overwriting the camera mid-session.
    camera.position.set(0, 1.7, 0);
    camera.quaternion.set(0.1, 0.2, 0.3, 0.92).normalize();
    camera.fov = 110;
    camera.updateProjectionMatrix();

    session.dispatch('end');
    // Listener removed itself; restore is queued for the next rAF.
    expect(session.listenerCount('end')).toBe(0);
    expect(camera.position.toArray()).not.toEqual(beforePos);

    flushRaf();

    expect(camera.position.toArray()).toEqual(beforePos);
    expect(camera.quaternion.toArray()).toEqual(beforeQuat);
    expect(camera.fov).toBe(beforeFov);
  });

  it('restore preserves local-space semantics when camera is parented to a moved player', () => {
    const player = new Group();
    const camera = new PerspectiveCamera();
    player.add(camera);
    camera.position.set(0, 1.7, 5);
    camera.updateMatrixWorld(true);
    const localBefore = camera.position.clone();

    const session = new FakeXRSession();
    attachBrowserCameraRestore(camera, session as unknown as XRSession);

    // Simulate locomotion moving the player while in XR + head pose drift.
    player.position.set(10, 0, 0);
    camera.position.set(0.1, 1.65, 0.05);

    session.dispatch('end');
    flushRaf();

    expect(camera.position.toArray()).toEqual(localBefore.toArray());
    // Local restored, so world tracks the new player position — documented
    // semantics for the local-space restore policy.
    camera.updateMatrixWorld(true);
    const worldPos = camera.getWorldPosition(camera.position.clone());
    expect(worldPos.x).toBeCloseTo(10);
  });
});
