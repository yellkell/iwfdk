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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REFERENCE_MODEL_ONNX_URL,
  getReferenceCacheStatus,
  getReferencePackageVersion,
  resolveReferenceAssets,
  warmupReferenceAssets,
} from '../src/assets.js';
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

async function writeStateFile(payload: Record<string, unknown>) {
  const statePath = path.join(
    workspaceRoot,
    '.iwsdk',
    'reference',
    'state.json',
  );
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function seedModelDir() {
  const modelDir = path.join(
    sharedRoot,
    'models',
    testModel.archiveSha256,
    'model',
  );
  await mkdir(path.join(modelDir, 'onnx'), { recursive: true });
  for (const [relativePath, contents] of Object.entries(MODEL_FILES)) {
    const absolutePath = path.join(modelDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, 'utf8');
  }
  return modelDir;
}

async function createArchive(
  rootName: string,
  files: Record<string, string>,
): Promise<{ buffer: Buffer; sha256: string; size: number }> {
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
    buffer,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
  };
}

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-assets-test-${Date.now()}-${Math.random()
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
  const fileHashes: Record<string, string> = {};
  for (const [relativePath, contents] of Object.entries(MODEL_FILES)) {
    fileHashes[relativePath] = createHash('sha256')
      .update(contents, 'utf8')
      .digest('hex');
  }
  testModel = {
    source: 'archive',
    format: 'transformers-js',
    archiveSha256: modelArchive.sha256,
    archiveSize: modelArchive.size,
    fileHashes,
    dtype: 'q8',
    pooling: 'mean',
    normalize: true,
  };
});

afterEach(async () => {
  delete process.env.IWSDK_REFERENCE_CACHE_DIR;
  delete process.env.IWSDK_REFERENCE_WORKSPACE_ROOT;
  delete process.env.IWSDK_REFERENCE_ASSETS_BASE_URL;
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

describe('reference cache status', () => {
  it('reports not_started when no cache state exists', async () => {
    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('not_started');
    expect(status.warmupRequired).toBe(true);
    expect(status.dataDir).toBeNull();
    expect(status.stateRoot).toBe(
      path.join(workspaceRoot, '.iwsdk', 'reference'),
    );
    expect(status.sharedDataRoot).toBe(path.join(sharedRoot, 'corpora'));
    expect(status.sharedModelRoot).toBe(path.join(sharedRoot, 'models'));
  });

  it('invalidates legacy reference cache state schemas', async () => {
    const packageVersion = getReferencePackageVersion();
    const modelDir = await seedModelDir();
    const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
    await mkdir(path.join(dataDir, 'sources'), { recursive: true });
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

    await writeStateFile({
      schemaVersion: 3,
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
    });

    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('not_started');
    expect(status.warmupRequired).toBe(true);
  });

  it('treats stale in-progress state as failed', async () => {
    const packageVersion = getReferencePackageVersion();
    await writeStateFile({
      schemaVersion: 4,
      packageVersion,
      assetsPackage: {
        name: ASSETS_PACKAGE_NAME,
        version: packageVersion,
      },
      status: 'in_progress',
      pid: 999999,
      manifestUrl: null,
      dataDir: null,
      dataSha256: null,
      modelDir: null,
      modelSha256: null,
      modelUrl: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      updatedAt: new Date().toISOString(),
      error: null,
    });

    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('failed');
    expect(status.error?.message).toContain('interrupted');
  });

  it('resolves warmed assets from the validated cache', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
    const modelDir = await seedModelDir();
    await mkdir(path.join(dataDir, 'sources'), { recursive: true });
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

    await writeStateFile({
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
    });

    const resolved = await resolveReferenceAssets();
    expect(resolved.dataDir).toBe(dataDir);
    expect(resolved.modelDir).toBe(modelDir);
    expect(resolved.model).toEqual(testModel);
  });

  it('allows a warmed custom corpus source when no explicit override is set', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
    const modelDir = await seedModelDir();
    await mkdir(path.join(dataDir, 'sources'), { recursive: true });
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

    await writeStateFile({
      schemaVersion: 4,
      packageVersion,
      assetsPackage: {
        name: ASSETS_PACKAGE_NAME,
        version: packageVersion,
      },
      status: 'ready',
      pid: null,
      manifestUrl:
        'http://127.0.0.1:8791/packages/reference-assets/dist/manifest.json',
      dataDir,
      dataSha256: 'data-hash',
      modelDir,
      modelSha256: testModel.archiveSha256,
      modelUrl: REFERENCE_MODEL_ONNX_URL,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
    });

    delete process.env.IWSDK_REFERENCE_ASSETS_BASE_URL;

    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('ready');
    expect(status.warmupRequired).toBe(false);
  });

  it('downloads the corpus archive and pinned model files during warmup', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataArchive = await createArchive('data', {
      'embeddings.json': `${JSON.stringify(
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
      'sources/.keep': '',
    });

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://cdn.example.test/manifest.json') {
        return new Response(
          JSON.stringify({
            schemaVersion: 3,
            referenceVersion: packageVersion,
            assetsPackage: {
              name: ASSETS_PACKAGE_NAME,
              version: packageVersion,
            },
            generatedAt: new Date().toISOString(),
            assets: {
              data: {
                file: 'data.tgz',
                sha256: dataArchive.sha256,
                size: dataArchive.size,
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://cdn.example.test/data.tgz') {
        return new Response(dataArchive.buffer, {
          status: 200,
          headers: {
            'content-length': String(dataArchive.size),
          },
        });
      }
      if (url === REFERENCE_MODEL_ONNX_URL) {
        return new Response(MODEL_FILES['onnx/model_quantized.onnx'], {
          status: 200,
          headers: {
            'content-length': String(
              MODEL_FILES['onnx/model_quantized.onnx'].length,
            ),
          },
        });
      }
      if (url.endsWith('/config.json')) {
        return new Response(MODEL_FILES['config.json'], { status: 200 });
      }
      if (url.endsWith('/tokenizer.json')) {
        return new Response(MODEL_FILES['tokenizer.json'], { status: 200 });
      }
      if (url.endsWith('/tokenizer_config.json')) {
        return new Response(MODEL_FILES['tokenizer_config.json'], {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await warmupReferenceAssets();

    expect(status.initState).toBe('ready');
    expect(status.dataSha256).toBe(dataArchive.sha256);
    expect(status.modelSha256).toBe(testModel.archiveSha256);
    expect(status.modelUrl).toBe(REFERENCE_MODEL_ONNX_URL);
    expect(status.dataDir).toBe(
      path.join(sharedRoot, 'corpora', dataArchive.sha256, 'data'),
    );
    expect(status.modelDir).toBe(
      path.join(sharedRoot, 'models', testModel.archiveSha256, 'model'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.test/manifest.json',
    );
    expect(fetchMock).toHaveBeenCalledWith('https://cdn.example.test/data.tgz');
    expect(fetchMock).toHaveBeenCalledWith(REFERENCE_MODEL_ONNX_URL);
  });

  it('repairs a corrupted cached model directory during warmup', async () => {
    const packageVersion = getReferencePackageVersion();
    const corruptModelDir = await seedModelDir();
    await writeFile(
      path.join(corruptModelDir, 'config.json'),
      '{"corrupt":true}\n',
      'utf8',
    );

    const dataArchive = await createArchive('data', {
      'embeddings.json': `${JSON.stringify(
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
      'sources/.keep': '',
    });

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://cdn.example.test/manifest.json') {
        return new Response(
          JSON.stringify({
            schemaVersion: 3,
            referenceVersion: packageVersion,
            assetsPackage: {
              name: ASSETS_PACKAGE_NAME,
              version: packageVersion,
            },
            generatedAt: new Date().toISOString(),
            assets: {
              data: {
                file: 'data.tgz',
                sha256: dataArchive.sha256,
                size: dataArchive.size,
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://cdn.example.test/data.tgz') {
        return new Response(dataArchive.buffer, {
          status: 200,
          headers: {
            'content-length': String(dataArchive.size),
          },
        });
      }
      if (url === REFERENCE_MODEL_ONNX_URL) {
        return new Response(MODEL_FILES['onnx/model_quantized.onnx'], {
          status: 200,
          headers: {
            'content-length': String(
              MODEL_FILES['onnx/model_quantized.onnx'].length,
            ),
          },
        });
      }
      if (url.endsWith('/config.json')) {
        return new Response(MODEL_FILES['config.json'], { status: 200 });
      }
      if (url.endsWith('/tokenizer.json')) {
        return new Response(MODEL_FILES['tokenizer.json'], { status: 200 });
      }
      if (url.endsWith('/tokenizer_config.json')) {
        return new Response(MODEL_FILES['tokenizer_config.json'], {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await warmupReferenceAssets();
    const repairedConfig = await readFile(
      path.join(status.modelDir ?? '', 'config.json'),
      'utf8',
    );

    expect(status.initState).toBe('ready');
    expect(repairedConfig).toBe(MODEL_FILES['config.json']);
  });

  it('fails warmup clearly when the pinned ONNX download fails', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataArchive = await createArchive('data', {
      'embeddings.json': `${JSON.stringify(
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
      'sources/.keep': '',
    });

    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://cdn.example.test/manifest.json') {
        return new Response(
          JSON.stringify({
            schemaVersion: 3,
            referenceVersion: packageVersion,
            assetsPackage: {
              name: ASSETS_PACKAGE_NAME,
              version: packageVersion,
            },
            generatedAt: new Date().toISOString(),
            assets: {
              data: {
                file: 'data.tgz',
                sha256: dataArchive.sha256,
                size: dataArchive.size,
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://cdn.example.test/data.tgz') {
        return new Response(dataArchive.buffer, {
          status: 200,
          headers: {
            'content-length': String(dataArchive.size),
          },
        });
      }
      if (url === REFERENCE_MODEL_ONNX_URL) {
        return new Response('not found', { status: 404 });
      }
      if (url.endsWith('/config.json')) {
        return new Response('{}\n', { status: 200 });
      }
      if (url.endsWith('/tokenizer.json')) {
        return new Response('{"version":"1.0"}\n', { status: 200 });
      }
      if (url.endsWith('/tokenizer_config.json')) {
        return new Response('{}\n', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(warmupReferenceAssets()).rejects.toThrow(
      REFERENCE_MODEL_ONNX_URL,
    );
  });

  it('detects corrupted model files via per-file hashes', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
    const modelDir = await seedModelDir();
    await mkdir(path.join(dataDir, 'sources'), { recursive: true });
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
      path.join(modelDir, 'config.json'),
      '{"corrupt":true}\n',
      'utf8',
    );

    await writeStateFile({
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
    });

    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('failed');
    expect(status.error?.message).toContain('corrupted');
  });

  it('reports a mismatch when the warmed model does not match the corpus metadata', async () => {
    const packageVersion = getReferencePackageVersion();
    const dataDir = path.join(sharedRoot, 'corpora', 'data-hash', 'data');
    const modelDir = await seedModelDir();
    await mkdir(path.join(dataDir, 'sources'), { recursive: true });
    await writeFile(
      path.join(dataDir, 'embeddings.json'),
      `${JSON.stringify(
        {
          version: packageVersion,
          model: {
            ...testModel,
            archiveSha256: 'different-model-hash',
          },
          dimensions: 768,
          iwsdk: [],
          deps: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    await writeStateFile({
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
    });

    const status = await getReferenceCacheStatus();
    expect(status.initState).toBe('failed');
    expect(status.error?.message).toContain('does not match');
  });
});
