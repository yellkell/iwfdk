/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Euler, Quaternion, Vector3 } from '../../src/runtime/three.js';
import { SyncedEuler } from '../../src/transform/synced-euler.js';
import { SyncedQuaternion } from '../../src/transform/synced-quaternion.js';

describe('SyncedEuler', () => {
  let euler: SyncedEuler;

  beforeEach(() => {
    euler = new SyncedEuler();
  });

  describe('standalone behavior', () => {
    it('should behave like a normal Euler', () => {
      euler.set(Math.PI / 2, Math.PI, Math.PI / 4);
      expect(euler.x).toBeCloseTo(Math.PI / 2);
      expect(euler.y).toBeCloseTo(Math.PI);
      expect(euler.z).toBeCloseTo(Math.PI / 4);
    });

    it('should support rotation order', () => {
      euler.set(0, 0, 0, 'YXZ');
      expect(euler.order).toBe('YXZ');
    });

    it('should support setFromQuaternion', () => {
      const quat = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 2,
      );
      euler.setFromQuaternion(quat);
      expect(euler.y).toBeCloseTo(Math.PI / 2);
    });

    it('should support copy', () => {
      const other = new Euler(1, 2, 3, 'YXZ');
      euler.copy(other);
      expect(euler.x).toBeCloseTo(1);
      expect(euler.y).toBeCloseTo(2);
      expect(euler.z).toBeCloseTo(3);
      expect(euler.order).toBe('YXZ');
    });
  });

  describe('with synced quaternion', () => {
    let quat: SyncedQuaternion;
    let buffer: Float32Array;

    beforeEach(() => {
      buffer = new Float32Array(4);
      buffer[0] = 0;
      buffer[1] = 0;
      buffer[2] = 0;
      buffer[3] = 1; // Identity quaternion

      quat = new SyncedQuaternion();
      quat.setTarget(buffer);

      euler.setSyncedQuaternion(quat);
    });

    describe('rotation -> quaternion sync', () => {
      it('should update quaternion when rotation.y changes', () => {
        euler.y = Math.PI / 2;

        // Quaternion should be 90 degrees around Y
        expect(buffer[1]).toBeCloseTo(Math.sin(Math.PI / 4));
        expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
      });

      it('should update quaternion when rotation.x changes', () => {
        euler.x = Math.PI / 2;

        expect(buffer[0]).toBeCloseTo(Math.sin(Math.PI / 4));
        expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
      });

      it('should update quaternion when using set()', () => {
        euler.set(0, Math.PI, 0);

        // 180 degrees around Y
        expect(buffer[1]).toBeCloseTo(1);
        expect(buffer[3]).toBeCloseTo(0, 5);
      });

      it('should update quaternion with multiple angle changes', () => {
        euler.set(Math.PI / 4, Math.PI / 4, 0);

        // Verify quaternion buffer changed
        const length = Math.sqrt(
          buffer[0] ** 2 + buffer[1] ** 2 + buffer[2] ** 2 + buffer[3] ** 2,
        );
        expect(length).toBeCloseTo(1); // Quaternion should be normalized
      });

      it('should NOT mark rotation dirty when rotation updates quaternion', () => {
        euler.y = Math.PI / 2;

        // Read rotation immediately - should NOT recompute
        expect(euler.y).toBeCloseTo(Math.PI / 2);
      });
    });

    describe('quaternion -> rotation sync (lazy)', () => {
      it('should mark rotation dirty when quaternion changes externally', () => {
        quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

        // Rotation should be marked dirty but not computed yet
        // Reading it should trigger lazy computation
        expect(euler.y).toBeCloseTo(Math.PI / 2);
      });

      it('should NOT recompute rotation on multiple reads (caching)', () => {
        quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

        // First read triggers computation
        const y1 = euler.y;

        // Subsequent reads use cache (no recomputation)
        const y2 = euler.y;
        const y3 = euler.y;

        expect(y1).toBe(y2);
        expect(y2).toBe(y3);
      });

      it('should handle quaternion multiply operations', () => {
        quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);

        // Read to cache initial value
        const initial = euler.y;

        // Multiply quaternion (external change)
        quat.multiply(
          new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4),
        );

        // Read should return new value (should be PI/2 total)
        expect(euler.y).toBeCloseTo(Math.PI / 2);
        expect(euler.y).not.toBeCloseTo(initial);
      });

      it('should handle lookAt-like operations', () => {
        // Simulate lookAt by setting quaternion directly
        // Note: 180° rotation has Euler angle ambiguity - test with a different angle
        const lookAtQuat = new Quaternion().setFromEuler(
          new Euler(0, Math.PI / 2, 0),
        );
        quat.copy(lookAtQuat);

        expect(euler.y).toBeCloseTo(Math.PI / 2);
      });
    });

    describe('onChange suppression', () => {
      it('should NOT trigger rotation dirty when rotation updates quaternion', () => {
        const callback = vi.fn();
        quat._onChangeWithSuppression(callback);

        // Change rotation (should update quaternion WITHOUT triggering callback)
        euler.y = Math.PI / 2;

        // Callback should NOT be called (suppressed)
        expect(callback).not.toHaveBeenCalled();
      });

      it('should trigger callback for external quaternion changes', () => {
        const callback = vi.fn();
        quat._onChangeWithSuppression(callback);

        // External quaternion change (not from rotation)
        quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

        // Callback SHOULD be called
        expect(callback).toHaveBeenCalled();
      });
    });

    describe('rotation order', () => {
      it('should preserve rotation order when syncing', () => {
        euler.order = 'YXZ';
        euler.set(0.1, 0.2, 0.3);

        expect(euler.order).toBe('YXZ');
      });

      it('should use correct rotation order when computing from quaternion', () => {
        euler.order = 'YXZ';
        quat.setFromEuler(new Euler(0.1, 0.2, 0.3, 'YXZ'));

        // Reading should use YXZ order
        euler.y; // Trigger computation
        expect(euler.order).toBe('YXZ');
      });
    });
  });

  describe('edge cases', () => {
    let quat: SyncedQuaternion;
    let buffer: Float32Array;

    beforeEach(() => {
      buffer = new Float32Array([0, 0, 0, 1]);
      quat = new SyncedQuaternion().setTarget(buffer);
      euler.setSyncedQuaternion(quat);
    });

    it('should handle zero rotation', () => {
      euler.set(0, 0, 0);
      expect(buffer[0]).toBeCloseTo(0);
      expect(buffer[1]).toBeCloseTo(0);
      expect(buffer[2]).toBeCloseTo(0);
      expect(buffer[3]).toBeCloseTo(1);
    });

    it('should handle 360 degree rotation (wrapping)', () => {
      euler.y = Math.PI * 2;

      // Quaternions normalize 360° differently than Euler angles
      // The quaternion for 360° rotation is the same as 0° (identity)
      // But when converted back to Euler, we might get 0 or 2*PI
      // Just verify the quaternion is normalized and represents the same rotation
      const length = Math.sqrt(
        buffer[0] ** 2 + buffer[1] ** 2 + buffer[2] ** 2 + buffer[3] ** 2,
      );
      expect(length).toBeCloseTo(1); // Quaternion is normalized

      // Apply the rotation twice - should be identity-ish
      const testVec = new Vector3(1, 0, 0);
      const testQuat = new Quaternion(
        buffer[0],
        buffer[1],
        buffer[2],
        buffer[3],
      );
      testVec.applyQuaternion(testQuat);
      // After 360° rotation around Y, X axis vector should be roughly the same
      expect(testVec.x).toBeCloseTo(1, 1);
    });

    it('should handle gimbal lock scenarios', () => {
      // Set to gimbal lock position
      euler.x = Math.PI / 2;

      // This is a known gimbal lock angle
      const x = euler.x;
      expect(x).toBeCloseTo(Math.PI / 2);
    });

    it('should handle negative angles', () => {
      euler.y = -Math.PI / 2;

      expect(buffer[1]).toBeCloseTo(-Math.sin(Math.PI / 4));
      expect(buffer[3]).toBeCloseTo(Math.cos(Math.PI / 4));
    });
  });
});
