/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheManager } from '../../src/asset/cache-manager.js';
import { GLTFAssetLoader } from '../../src/asset/loaders/gltf-loader.js';
import {
  AnimationClip,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
} from '../../src/runtime/three.js';

function makeFakeGLTF(): GLTF {
  const geometry = new SphereGeometry();
  const material = new MeshStandardMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.name = 'TestMesh';

  const scene = new Group();
  scene.name = 'TestScene';
  scene.add(mesh);

  const animations: AnimationClip[] = [];
  return {
    scene,
    scenes: [scene],
    animations,
    cameras: [],
    asset: { version: '2.0' },
    parser: undefined as unknown as GLTF['parser'],
    userData: {},
  };
}

describe('GLTFAssetLoader.getGLTF', () => {
  beforeEach(() => {
    CacheManager.clear();
    const gltf = makeFakeGLTF();
    CacheManager.setKeyToUrl('test', 'https://example.invalid/test.glb');
    CacheManager.setAsset('https://example.invalid/test.glb', gltf);
  });

  afterEach(() => {
    CacheManager.clear();
  });

  it('returns null for unknown keys', () => {
    expect(GLTFAssetLoader.getGLTF('missing')).toBeNull();
  });

  it('returns a fresh scene clone on every call by default', () => {
    const a = GLTFAssetLoader.getGLTF('test');
    const b = GLTFAssetLoader.getGLTF('test');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.scene).not.toBe(b!.scene);
    expect(a!.scenes[0]).not.toBe(b!.scenes[0]);
  });

  it('shares geometries, materials, and animations across clones', () => {
    const a = GLTFAssetLoader.getGLTF('test')!;
    const b = GLTFAssetLoader.getGLTF('test')!;
    const meshA = a.scene.children[0] as Mesh;
    const meshB = b.scene.children[0] as Mesh;
    expect(meshA.geometry).toBe(meshB.geometry);
    expect(meshA.material).toBe(meshB.material);
    expect(a.animations).toBe(b.animations);
  });

  it('returns the cached instance when { shared: true }', () => {
    const a = GLTFAssetLoader.getGLTF('test', { shared: true });
    const b = GLTFAssetLoader.getGLTF('test', { shared: true });
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a!.scene).toBe(b!.scene);
  });

  it('returns scenes with no parent so multi-entity placement does not steal ownership', () => {
    const parentA = new Group();
    const parentB = new Group();

    const a = GLTFAssetLoader.getGLTF('test')!;
    parentA.add(a.scene);

    const b = GLTFAssetLoader.getGLTF('test')!;
    parentB.add(b.scene);

    expect(a.scene.parent).toBe(parentA);
    expect(b.scene.parent).toBe(parentB);
    expect(parentA.children).toContain(a.scene);
    expect(parentB.children).toContain(b.scene);
  });

  it('rebinds SkinnedMesh skeletons so each clone has its own bones', () => {
    const root = new Group();
    root.name = 'SkinnedRoot';

    const bone = new Bone();
    bone.name = 'Bone0';
    root.add(bone);

    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'skinIndex',
      new BufferAttribute(new Uint16Array(4), 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new BufferAttribute(new Float32Array(4), 4),
    );
    const skinnedMesh = new SkinnedMesh(geometry, new MeshStandardMaterial());
    skinnedMesh.name = 'SkinnedTestMesh';
    skinnedMesh.bind(new Skeleton([bone]));
    root.add(skinnedMesh);

    CacheManager.setAsset('https://example.invalid/test.glb', {
      scene: root,
      scenes: [root],
      animations: [],
      cameras: [],
      asset: { version: '2.0' },
      parser: undefined as unknown as GLTF['parser'],
      userData: {},
    });

    const a = GLTFAssetLoader.getGLTF('test')!;
    const b = GLTFAssetLoader.getGLTF('test')!;

    const meshA = a.scene.getObjectByName('SkinnedTestMesh') as SkinnedMesh;
    const meshB = b.scene.getObjectByName('SkinnedTestMesh') as SkinnedMesh;
    const boneA = a.scene.getObjectByName('Bone0') as Bone;
    const boneB = b.scene.getObjectByName('Bone0') as Bone;

    expect(meshA).toBeInstanceOf(SkinnedMesh);
    expect(meshB).toBeInstanceOf(SkinnedMesh);
    expect(meshA).not.toBe(meshB);

    expect(boneA).not.toBe(boneB);
    expect(boneA.parent).toBe(a.scene);
    expect(boneB.parent).toBe(b.scene);

    expect(meshA.skeleton).not.toBe(meshB.skeleton);
    expect(meshA.skeleton.bones[0]).toBe(boneA);
    expect(meshB.skeleton.bones[0]).toBe(boneB);
  });
});
