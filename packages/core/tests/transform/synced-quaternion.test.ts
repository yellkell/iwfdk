/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Quaternion, Euler, Vector3 } from '../../src/runtime/three.js';
import { SyncedQuaternion } from '../../src/transform/synced-quaternion.js';

describe('SyncedQuaternion', () => {
  let synced: SyncedQuaternion;
  let buffer: Float32Array;

  beforeEach(() => {
    buffer = new Float32Array(4);
    synced = new SyncedQuaternion();
  });

  describe('without target (standalone behavior)', () => {
    it('should behave like a normal Quaternion', () => {
      synced.set(0.1, 0.2, 0.3, 0.4);
      expect(synced.x).toBeCloseTo(0.1);
      expect(synced.y).toBeCloseTo(0.2);
      expect(synced.z).toBeCloseTo(0.3);
      expect(synced.w).toBeCloseTo(0.4);
    });

    it('should support setFromAxisAngle', () => {
      const axis = new Vector3(0, 1, 0);
      synced.setFromAxisAngle(axis, Math.PI / 2);
      expect(synced.x).toBeCloseTo(0);
      expect(synced.y).toBeCloseTo(Math.sin(Math.PI / 4));
      expect(synced.z).toBeCloseTo(0);
      expect(synced.w).toBeCloseTo(Math.cos(Math.PI / 4));
    });

    it('should support multiply', () => {
      synced.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const other = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
      );
      synced.multiply(other);
      // Should be 180 degrees around Y
      expect(synced.y).toBeCloseTo(1);
      expect(synced.w).toBeCloseTo(0);
    });
  });

  describe('with target (synced behavior)', () => {
    beforeEach(() => {
      buffer[0] = 0;
      buffer[1] = 0.707; // 90 degrees around Y axis
      buffer[2] = 0;
      buffer[3] = 0.707;
      synced.setTarget(buffer);
    });

    it('should read from buffer', () => {
      expect(synced.x).toBeCloseTo(0);
      expect(synced.y).toBeCloseTo(0.707);
      expect(synced.z).toBeCloseTo(0);
      expect(synced.w).toBeCloseTo(0.707);
    });

    it('should write to buffer', () => {
      synced.set(0.1, 0.2, 0.3, 0.4);
      expect(buffer[0]).toBeCloseTo(0.1);
      expect(buffer[1]).toBeCloseTo(0.2);
      expect(buffer[2]).toBeCloseTo(0.3);
      expect(buffer[3]).toBeCloseTo(0.4);
    });

    it('should sync setFromAxisAngle to buffer', () => {
      synced.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
      expect(buffer[0]).toBeCloseTo(1);
      expect(buffer[1]).toBeCloseTo(0);
      expect(buffer[2]).toBeCloseTo(0);
      expect(buffer[3]).toBeCloseTo(0);
    });

    it('should sync multiply to buffer', () => {
      // Start with identity
      synced.set(0, 0, 0, 1);
      const rotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
      );
      synced.multiply(rotation);

      // Should now be 90 degrees around Y
      expect(buffer[1]).toBeCloseTo(Math.sin(Math.PI / 4));
      expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
    });

    it('should sync normalize to buffer', () => {
      // Set unnormalized values
      synced.set(1, 2, 3, 4);
      synced.normalize();

      const length = Math.sqrt(
        buffer[0] * buffer[0] +
          buffer[1] * buffer[1] +
          buffer[2] * buffer[2] +
          buffer[3] * buffer[3],
      );
      expect(length).toBeCloseTo(1);
    });

    it('should sync slerp to buffer', () => {
      synced.set(0, 0, 0, 1); // Identity
      const target = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI,
      );
      synced.slerp(target, 0.5);

      // Should be halfway between identity and 180° rotation
      expect(buffer[1]).toBeCloseTo(Math.sin(Math.PI / 4)); // 45° rotation
      expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
    });

    it('should sync setFromEuler to buffer', () => {
      const euler = new Euler(0, Math.PI / 2, 0);
      synced.setFromEuler(euler);

      expect(buffer[0]).toBeCloseTo(0);
      expect(buffer[1]).toBeCloseTo(Math.sin(Math.PI / 4));
      expect(buffer[2]).toBeCloseTo(0);
      expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
    });
  });

  describe('onChange callbacks', () => {
    it('should call onChange when values change', () => {
      const callback = vi.fn();
      synced._onChange(callback);

      synced.set(0, 0, 0, 1);
      expect(callback).toHaveBeenCalled();
    });

    it('should call onChange for each component change', () => {
      const callback = vi.fn();
      synced._onChange(callback);

      synced.x = 0.1;
      synced.y = 0.2;
      synced.z = 0.3;
      synced.w = 0.4;

      // Should be called at least 4 times (once per component)
      expect(callback).toHaveBeenCalled();
      expect(callback.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should call onChange for operations like multiply', () => {
      const callback = vi.fn();
      synced._onChange(callback);

      synced.multiply(new Quaternion(0, 0.707, 0, 0.707));
      // multiply internally modifies x, y, z, w
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('onChange suppression', () => {
    it('should suppress onChange during _withSuppressedOnChange', () => {
      const callback = vi.fn();
      synced._onChangeWithSuppression(callback);

      synced._withSuppressedOnChange(() => {
        synced.set(0.1, 0.2, 0.3, 0.4);
      });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should resume onChange after suppression', () => {
      const callback = vi.fn();
      synced._onChange(callback);

      synced._withSuppressedOnChange(() => {
        synced.set(0.1, 0.2, 0.3, 0.4);
      });

      synced.set(0.5, 0.6, 0.7, 0.8);
      expect(callback).toHaveBeenCalled();
    });

    it('should use _onChangeWithSuppression correctly', () => {
      const callback = vi.fn();
      synced._onChangeWithSuppression(callback);

      // Normal change should trigger callback
      synced.set(0.1, 0.2, 0.3, 0.4);
      expect(callback).toHaveBeenCalled(); // At least once

      callback.mockClear();

      // Suppressed change should not trigger callback
      synced._withSuppressedOnChange(() => {
        synced.set(0.5, 0.6, 0.7, 0.8);
      });
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('with target and offset', () => {
    it('should read/write at correct offset', () => {
      const bigBuffer = new Float32Array(10);
      bigBuffer[3] = 0.1;
      bigBuffer[4] = 0.2;
      bigBuffer[5] = 0.3;
      bigBuffer[6] = 0.4;

      synced.setTarget(bigBuffer, 3);
      expect(synced.x).toBeCloseTo(0.1);
      expect(synced.y).toBeCloseTo(0.2);
      expect(synced.z).toBeCloseTo(0.3);
      expect(synced.w).toBeCloseTo(0.4);

      synced.set(0.5, 0.6, 0.7, 0.8);
      expect(bigBuffer[3]).toBeCloseTo(0.5);
      expect(bigBuffer[4]).toBeCloseTo(0.6);
      expect(bigBuffer[5]).toBeCloseTo(0.7);
      expect(bigBuffer[6]).toBeCloseTo(0.8);
    });
  });

  describe('edge cases', () => {
    beforeEach(() => {
      synced.setTarget(buffer);
    });

    it('should handle identity quaternion', () => {
      synced.set(0, 0, 0, 1);
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(0);
      expect(buffer[2]).toBe(0);
      expect(buffer[3]).toBe(1);
    });

    it('should handle 180 degree rotation', () => {
      synced.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI);
      expect(buffer[0]).toBeCloseTo(1);
      expect(buffer[1]).toBeCloseTo(0);
      expect(buffer[2]).toBeCloseTo(0);
      expect(buffer[3]).toBeCloseTo(0, 5);
    });

    it('should handle conjugate', () => {
      synced.set(0.1, 0.2, 0.3, 0.4);
      synced.conjugate();
      expect(buffer[0]).toBeCloseTo(-0.1);
      expect(buffer[1]).toBeCloseTo(-0.2);
      expect(buffer[2]).toBeCloseTo(-0.3);
      expect(buffer[3]).toBeCloseTo(0.4);
    });

    it('should handle invert', () => {
      synced.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const original = synced.clone();
      synced.invert();

      // Multiplying a quaternion by its inverse should give identity
      synced.multiply(original);
      expect(synced.w).toBeCloseTo(1);
      expect(synced.x).toBeCloseTo(0, 5);
      expect(synced.y).toBeCloseTo(0, 5);
      expect(synced.z).toBeCloseTo(0, 5);
    });
  });
});
