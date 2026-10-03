/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createHash } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REFERENCE_MODEL_ONNX_URL,
  getReferencePackageVersion,
} from '../src/assets.js';
import { FileService } from '../src/files.js';
import type { ReferenceEmbeddingModelMetadata } from '../src/types.js';

const ASSETS_PACKAGE_NAME = '@iwsdk/reference-assets';
const MODEL_FILES = {
  'config.json': '{}\n',
  'tokenizer.json': '{"version":"1.0"}\n',
  'tokenizer_config.json': '{}\n',
  'onnx/model_quantized.onnx': 'onnx',
} as const;

let tempDir: string;
let workspaceRoot: string;
let sharedRoot: string;
let testModel: ReferenceEmbeddingModelMetadata;

async function createArchive(
  rootName: string,
  files: Record<string, string>,
): Promise<{ sha256: string; size: number }> {
  const sourceRoot = path.join(tempDir, `${rootName}-source`);
  const archivePath = path.join(tempDir, `${rootName}.tgz`);
  const archiveRoot = path.join(sourceRoot, rootName);

  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(archiveRoot, { recursive: true });
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(archiveRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }

  await tar.c(
    {
      cwd: sourceRoot,
      file: archivePath,
      gzip: true,
      portable: true,
      noPax: true,
      mtime: new Date(0),
    },
    [rootName],
  );

  const buffer = await readFile(archivePath);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
  };
}

async function seedReadyCache() {
  const packageVersion = getReferencePackageVersion();
  const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
  const modelDir = path.join(
    sharedRoot,
    'models',
    testModel.archiveSha256,
    'model',
  );
  await mkdir(
    path.join(dataDir, 'sources', 'iwsdk', 'packages', 'core', 'src'),
    {
      recursive: true,
    },
  );
  await mkdir(path.join(dataDir, 'sources', 'deps', '@types', 'three'), {
    recursive: true,
  });
  await mkdir(path.join(modelDir, 'onnx'), { recursive: true });
  await writeFile(
    path.join(dataDir, 'embeddings.json'),
    `${JSON.stringify(
      {
        version: packageVersion,
        model: testModel,
        dimensions: 768,
        iwsdk: [],
        deps: [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  await writeFile(
    path.join(
      dataDir,
      'sources',
      'iwsdk',
      'packages',
      'core',
      'src',
      'index.ts',
    ),
    'export const value = 1;\n',
    'utf8',
  );
  await writeFile(
    path.join(dataDir, 'sources', 'deps', '@types', 'three', 'index.d.ts'),
    'export interface Vector3 {}\n',
    'utf8',
  );
  for (const [relativePath, contents] of Object.entries(MODEL_FILES)) {
    const absolutePath = path.join(modelDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }

  const statePath = path.join(
    workspaceRoot,
    '.iwsdk',
    'reference',
    'state.json',
  );
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        schemaVersion: 4,
        packageVersion,
        assetsPackage: {
          name: ASSETS_PACKAGE_NAME,
          version: packageVersion,
        },
        status: 'ready',
        pid: null,
        manifestUrl: 'https://cdn.example.test/manifest.json',
        dataDir,
        dataSha256: 'data-hash',
        modelDir,
        modelSha256: testModel.archiveSha256,
        modelUrl: REFERENCE_MODEL_ONNX_URL,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-files-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  workspaceRoot = path.join(tempDir, 'app');
  sharedRoot = path.join(tempDir, 'shared');
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'package.json'),
    '{ "name": "fixture-app", "private": true }\n',
    'utf8',
  );
  process.env.IWSDK_REFERENCE_WORKSPACE_ROOT = workspaceRoot;
  process.env.IWSDK_REFERENCE_CACHE_DIR = sharedRoot;
  process.env.IWSDK_REFERENCE_ASSETS_BASE_URL = 'https://cdn.example.test';
  const modelArchive = await createArchive('model', MODEL_FILES);
  testModel = {
    source: 'archive',
    format: 'transformers-js',
    archiveSha256: modelArchive.sha256,
    archiveSize: modelArchive.size,
    dtype: 'q8',
    pooling: 'mean',
    normalize: true,
  };
  await seedReadyCache();
});

afterEach(async () => {
  delete process.env.IWSDK_REFERENCE_CACHE_DIR;
  delete process.env.IWSDK_REFERENCE_WORKSPACE_ROOT;
  delete process.env.IWSDK_REFERENCE_ASSETS_BASE_URL;
  await rm(tempDir, { recursive: true, force: true });
});

describe('FileService', () => {
  it('reads IWSDK files from the warmed corpus', async () => {
    const service = new FileService();
    const content = await service.readFile(
      'packages/core/src/index.ts',
      'iwsdk',
    );
    expect(content).toContain('value = 1');
  });

  it('resolves dependency files from normalized legacy node_modules paths', async () => {
    const service = new FileService();
    const content = await service.readFile(
      '/tmp/workspace/node_modules/.pnpm/@types+three@0.1.0/node_modules/@types/three/index.d.ts',
      'deps',
    );
    expect(content).toContain('Vector3');
  });
});
