/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Euler } from '../runtime/three.js';
import type { SyncedQuaternion } from './synced-quaternion.js';

/**
 * Euler rotation that stays automatically synced with a SyncedQuaternion using lazy evaluation.
 *
 * @remarks
 * - When you modify rotation.x/y/z, it automatically updates the synced quaternion
 * - When the quaternion is updated (via methods OR direct buffer writes), rotation is recomputed
 * - Rotation values are lazily computed from quaternion only when read (performance optimization)
 * - Multiple reads in the same frame use cached values (quaternion comparison detects changes)
 * - This is MORE performant than Three.js's default behavior which always syncs immediately
 *
 * @category Scene
 */
export class SyncedEuler extends Euler {
  private syncedQuaternion: SyncedQuaternion | null = null;
  private __x: number = 0;
  private __y: number = 0;
  private __z: number = 0;
  private __order: string = 'XYZ';
  private isDirty: boolean = false;
  // Cache last quaternion values to detect external buffer modifications
  private lastQuatX: number = 0;
  private lastQuatY: number = 0;
  private lastQuatZ: number = 0;
  private lastQuatW: number = 1;

  constructor(x = 0, y = 0, z = 0, order: any = 'XYZ') {
    super(x, y, z, order);
    // Preserve values from parent constructor
    this.__x = (this as any)._x;
    this.__y = (this as any)._y;
    this.__z = (this as any)._z;
    this.__order = (this as any)._order;
    this.setupProperties();
  }

  private setupProperties() {
    // Override internal properties with lazy sync behavior
    Object.defineProperty(this, '_x', {
      get: () => {
        // Check if quaternion changed externally (e.g., direct buffer write)
        this.checkQuaternionChanged();
        // Lazily sync from quaternion if dirty
        if (this.isDirty) {
          this.syncFromQuaternion();
        }
        return this.__x;
      },
      set: (value: number) => {
        this.__x = value;
        this.isDirty = false; // Values are fresh since we just set them
        this.updateQuaternion();
        // Call parent's onChange callback for any listeners
        (this as any)._onChangeCallback();
      },
      enumerable: true,
      configurable: true,
    });

    Object.defineProperty(this, '_y', {
      get: () => {
        // Check if quaternion changed externally (e.g., direct buffer write)
        this.checkQuaternionChanged();
        // Lazily sync from quaternion if dirty
        if (this.isDirty) {
          this.syncFromQuaternion();
        }
        return this.__y;
      },
      set: (value: number) => {
        this.__y = value;
        this.isDirty = false; // Values are fresh since we just set them
        this.updateQuaternion();
        // Call parent's onChange callback for any listeners
        (this as any)._onChangeCallback();
      },
      enumerable: true,
      configurable: true,
    });

    Object.defineProperty(this, '_z', {
      get: () => {
        // Check if quaternion changed externally (e.g., direct buffer write)
        this.checkQuaternionChanged();
        // Lazily sync from quaternion if dirty
        if (this.isDirty) {
          this.syncFromQuaternion();
        }
        return this.__z;
      },
      set: (value: number) => {
        this.__z = value;
        this.isDirty = false; // Values are fresh since we just set them
        this.updateQuaternion();
        // Call parent's onChange callback for any listeners
        (this as any)._onChangeCallback();
      },
      enumerable: true,
      configurable: true,
    });

    Object.defineProperty(this, '_order', {
      get: () => {
        // Order doesn't need sync from quaternion, but check dirty for consistency
        if (this.isDirty) {
          this.syncFromQuaternion();
        }
        return this.__order;
      },
      set: (value: string) => {
        this.__order = value;
        this.isDirty = false; // Values are fresh since we just set them
        this.updateQuaternion();
        // Call parent's onChange callback for any listeners
        (this as any)._onChangeCallback();
      },
      enumerable: true,
      configurable: true,
    });
  }

  /**
   * Link this Euler to a SyncedQuaternion for automatic bidirectional sync.
   */
  setSyncedQuaternion(quaternion: SyncedQuaternion): this {
    this.syncedQuaternion = quaternion;

    // Initialize cached quaternion values
    this.lastQuatX = quaternion.x;
    this.lastQuatY = quaternion.y;
    this.lastQuatZ = quaternion.z;
    this.lastQuatW = quaternion.w;

    // Register callback that marks rotation dirty when quaternion changes from external sources
    // The callback is automatically suppressed when rotation updates quaternion
    quaternion._onChangeWithSuppression(() => {
      this.markDirty();
    });

    return this;
  }

  /**
   * Check if quaternion values changed (e.g., via direct buffer writes).
   * If changed, mark as dirty so we recompute on next read.
   * This is cheap: just 4 float comparisons!
   */
  private checkQuaternionChanged(): void {
    if (!this.syncedQuaternion || this.isDirty) {
      return; // Already dirty, no need to check
    }

    // Compare current quaternion values to cached values
    // This catches external buffer modifications that bypass onChange callbacks
    if (
      this.syncedQuaternion.x !== this.lastQuatX ||
      this.syncedQuaternion.y !== this.lastQuatY ||
      this.syncedQuaternion.z !== this.lastQuatZ ||
      this.syncedQuaternion.w !== this.lastQuatW
    ) {
      this.isDirty = true;
    }
  }

  /**
   * Mark rotation as dirty (needs recompute from quaternion).
   * Called automatically when quaternion changes.
   * This is cheap - just a flag flip, no computation!
   */
  private markDirty(): void {
    this.isDirty = true;
  }

  /**
   * Update the synced quaternion from current Euler values.
   * Called automatically when Euler values change.
   */
  private updateQuaternion(): void {
    if (!this.syncedQuaternion) {
      return;
    }

    // Suppress the onChange callback to prevent marking rotation dirty
    // when we're the ones updating the quaternion!
    this.syncedQuaternion._withSuppressedOnChange(() => {
      // Use setFromEuler to convert Euler to quaternion
      this.syncedQuaternion!.setFromEuler(this, false);
    });

    // Update cached quaternion values since we just changed it
    this.lastQuatX = this.syncedQuaternion.x;
    this.lastQuatY = this.syncedQuaternion.y;
    this.lastQuatZ = this.syncedQuaternion.z;
    this.lastQuatW = this.syncedQuaternion.w;
  }

  /**
   * Update Euler values from the synced quaternion.
   * Called lazily when rotation is read and marked dirty.
   * After this, isDirty is cleared and values are cached.
   */
  private syncFromQuaternion(): void {
    if (!this.syncedQuaternion || !this.isDirty) {
      return;
    }

    // Update internal values from quaternion (without triggering setters)
    const euler = new Euler().setFromQuaternion(
      this.syncedQuaternion,
      this.__order as any,
      false,
    );

    this.__x = (euler as any)._x;
    this.__y = (euler as any)._y;
    this.__z = (euler as any)._z;

    // Cache current quaternion values so we can detect external changes
    this.lastQuatX = this.syncedQuaternion.x;
    this.lastQuatY = this.syncedQuaternion.y;
    this.lastQuatZ = this.syncedQuaternion.z;
    this.lastQuatW = this.syncedQuaternion.w;

    // Clear dirty flag - values are now fresh and cached
    this.isDirty = false;
  }
}
