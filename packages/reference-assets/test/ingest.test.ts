/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectIwsdkSourceFiles,
  createEmbeddingsPayload,
  detectMonorepoRoot,
  getProducerPaths,
  resolveIncludedDependencyRoots,
} from '../tools/ingest.js';

let tempDir: string;
let repoRoot: string;

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-assets-ingest-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  repoRoot = path.join(tempDir, 'immersive-web-sdk');
  await mkdir(path.join(repoRoot, 'packages', 'reference-assets'), {
    recursive: true,
  });
  await writeFile(
    path.join(repoRoot, 'pnpm-workspace.yaml'),
    "packages:\n  - 'packages/*'\n",
  );
  await writeFile(
    path.join(repoRoot, 'packages', 'reference-assets', 'package.json'),
    '{}\n',
    'utf8',
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('ingest helpers', () => {
  it('detects the monorepo root from a nested cwd', async () => {
    const nestedDir = path.join(repoRoot, 'packages', 'core', 'src');
    await mkdir(nestedDir, { recursive: true });
    expect(detectMonorepoRoot(nestedDir)).toBe(repoRoot);
  });

  it('resolves dependency roots from the installed node_modules tree', async () => {
    const webxrRoot = path.join(repoRoot, 'node_modules', '@types', 'webxr');
    await mkdir(webxrRoot, { recursive: true });
    await writeFile(
      path.join(webxrRoot, 'index.d.ts'),
      'export interface XR {}\n',
    );

    const manifests = await resolveIncludedDependencyRoots(repoRoot);
    const webxr = manifests.find(
      (entry) => entry.packageName === '@types/webxr',
    );
    expect(webxr?.outputRoot).toBe('@types/webxr');
    expect(webxr?.files).toHaveLength(1);
    expect(webxr?.files[0]).toContain(
      path.join('@types', 'webxr', 'index.d.ts'),
    );
  });

  it('ignores generated producer corpus files when collecting monorepo source', async () => {
    const realSourceFile = path.join(
      repoRoot,
      'packages',
      'core',
      'src',
      'app.ts',
    );
    const generatedSourceFile = path.join(
      repoRoot,
      'packages',
      'reference-assets',
      'data',
      'sources',
      'deps',
      '@types',
      'webxr',
      'index.d.ts',
    );

    await mkdir(path.dirname(realSourceFile), { recursive: true });
    await mkdir(path.dirname(generatedSourceFile), { recursive: true });
    await writeFile(realSourceFile, 'export const app = true;\n', 'utf8');
    await writeFile(generatedSourceFile, 'export interface XR {}\n', 'utf8');

    const files = await collectIwsdkSourceFiles(repoRoot);
    expect(files).toContain(realSourceFile);
    expect(files).not.toContain(generatedSourceFile);
  });

  it('keeps temp output scoped to the producer package', () => {
    const paths = getProducerPaths();
    expect(paths.tempDir).toContain(
      path.join('packages', 'reference-assets', 'tools', '.temp'),
    );
    expect(paths.legacyTempDir).toContain(
      path.join('packages', 'tools', '.temp'),
    );
    expect(paths.tempDir).not.toBe(paths.legacyTempDir);
  });

  it('records archive-backed model metadata in embeddings output', () => {
    const model = {
      source: 'archive',
      format: 'transformers-js',
      archiveSha256: 'model-hash',
      archiveSize: 123,
      dtype: 'q8',
      pooling: 'mean',
      normalize: true,
    } as const;

    const payload = createEmbeddingsPayload(
      '0.3.1',
      model,
      [{ embedding: [1, 2, 3] }],
      [],
    );

    expect(payload).toMatchObject({
      version: '0.3.1',
      model,
      dimensions: 3,
    });
  });
});
