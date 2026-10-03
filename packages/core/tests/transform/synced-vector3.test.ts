/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vector3 } from '../../src/runtime/three.js';
import { SyncedVector3 } from '../../src/transform/synced-vector3.js';

describe('SyncedVector3', () => {
  let synced: SyncedVector3;
  let buffer: Float32Array;

  beforeEach(() => {
    buffer = new Float32Array(3);
    synced = new SyncedVector3();
  });

  describe('without target (standalone behavior)', () => {
    it('should behave like a normal Vector3', () => {
      synced.set(1, 2, 3);
      expect(synced.x).toBe(1);
      expect(synced.y).toBe(2);
      expect(synced.z).toBe(3);
    });

    it('should support all Vector3 methods', () => {
      synced.set(1, 2, 3);
      synced.multiplyScalar(2);
      expect(synced.x).toBe(2);
      expect(synced.y).toBe(4);
      expect(synced.z).toBe(6);
    });

    it('should support vector addition', () => {
      synced.set(1, 2, 3);
      const other = new Vector3(10, 20, 30);
      synced.add(other);
      expect(synced.x).toBe(11);
      expect(synced.y).toBe(22);
      expect(synced.z).toBe(33);
    });
  });

  describe('with target (synced behavior)', () => {
    beforeEach(() => {
      buffer[0] = 5;
      buffer[1] = 10;
      buffer[2] = 15;
      synced.setTarget(buffer);
    });

    it('should read from buffer', () => {
      expect(synced.x).toBe(5);
      expect(synced.y).toBe(10);
      expect(synced.z).toBe(15);
    });

    it('should write to buffer', () => {
      synced.x = 100;
      synced.y = 200;
      synced.z = 300;
      expect(buffer[0]).toBe(100);
      expect(buffer[1]).toBe(200);
      expect(buffer[2]).toBe(300);
    });

    it('should sync set() to buffer', () => {
      synced.set(7, 8, 9);
      expect(buffer[0]).toBe(7);
      expect(buffer[1]).toBe(8);
      expect(buffer[2]).toBe(9);
    });

    it('should sync setX/Y/Z to buffer', () => {
      synced.setX(42);
      expect(buffer[0]).toBe(42);

      synced.setY(43);
      expect(buffer[1]).toBe(43);

      synced.setZ(44);
      expect(buffer[2]).toBe(44);
    });

    it('should sync vector operations to buffer', () => {
      synced.multiplyScalar(2);
      expect(buffer[0]).toBe(10);
      expect(buffer[1]).toBe(20);
      expect(buffer[2]).toBe(30);
    });

    it('should sync addition to buffer', () => {
      synced.add(new Vector3(1, 1, 1));
      expect(buffer[0]).toBe(6);
      expect(buffer[1]).toBe(11);
      expect(buffer[2]).toBe(16);
    });

    it('should sync copy to buffer', () => {
      synced.copy(new Vector3(99, 88, 77));
      expect(buffer[0]).toBe(99);
      expect(buffer[1]).toBe(88);
      expect(buffer[2]).toBe(77);
    });

    it('should sync normalize to buffer', () => {
      synced.set(3, 0, 4); // length = 5
      synced.normalize();
      expect(buffer[0]).toBeCloseTo(0.6);
      expect(buffer[1]).toBeCloseTo(0);
      expect(buffer[2]).toBeCloseTo(0.8);
    });

    it('should sync lerp to buffer', () => {
      synced.set(0, 0, 0);
      const target = new Vector3(10, 20, 30);
      synced.lerp(target, 0.5);
      expect(buffer[0]).toBe(5);
      expect(buffer[1]).toBe(10);
      expect(buffer[2]).toBe(15);
    });
  });

  describe('with target and offset', () => {
    it('should read/write at correct offset', () => {
      const bigBuffer = new Float32Array(10);
      bigBuffer[3] = 1;
      bigBuffer[4] = 2;
      bigBuffer[5] = 3;

      synced.setTarget(bigBuffer, 3);
      expect(synced.x).toBe(1);
      expect(synced.y).toBe(2);
      expect(synced.z).toBe(3);

      synced.set(7, 8, 9);
      expect(bigBuffer[3]).toBe(7);
      expect(bigBuffer[4]).toBe(8);
      expect(bigBuffer[5]).toBe(9);
    });
  });

  describe('target switching', () => {
    it('should switch between standalone and synced mode', () => {
      // Start standalone
      synced.set(1, 2, 3);
      expect(synced.x).toBe(1);

      // Switch to synced
      buffer[0] = 10;
      synced.setTarget(buffer);
      expect(synced.x).toBe(10);

      synced.x = 20;
      expect(buffer[0]).toBe(20);
    });

    it('should handle switching targets', () => {
      const buffer1 = new Float32Array([1, 2, 3]);
      const buffer2 = new Float32Array([10, 20, 30]);

      synced.setTarget(buffer1);
      expect(synced.x).toBe(1);
      synced.x = 5;
      expect(buffer1[0]).toBe(5);

      synced.setTarget(buffer2);
      expect(synced.x).toBe(10);
      synced.x = 50;
      expect(buffer2[0]).toBe(50);
      expect(buffer1[0]).toBe(5); // Old buffer unchanged
    });
  });

  describe('edge cases', () => {
    it('should handle zero vector', () => {
      synced.setTarget(buffer);
      synced.set(0, 0, 0);
      expect(buffer[0]).toBe(0);
      expect(buffer[1]).toBe(0);
      expect(buffer[2]).toBe(0);
    });

    it('should handle negative values', () => {
      synced.setTarget(buffer);
      synced.set(-1, -2, -3);
      expect(buffer[0]).toBe(-1);
      expect(buffer[1]).toBe(-2);
      expect(buffer[2]).toBe(-3);
    });

    it('should handle very large values', () => {
      synced.setTarget(buffer);
      synced.set(1e10, 1e10, 1e10);
      expect(buffer[0]).toBe(1e10);
      expect(buffer[1]).toBe(1e10);
      expect(buffer[2]).toBe(1e10);
    });

    it('should handle very small values', () => {
      synced.setTarget(buffer);
      synced.set(1e-10, 1e-10, 1e-10);
      expect(buffer[0]).toBeCloseTo(1e-10);
      expect(buffer[1]).toBeCloseTo(1e-10);
      expect(buffer[2]).toBeCloseTo(1e-10);
    });
  });
});
