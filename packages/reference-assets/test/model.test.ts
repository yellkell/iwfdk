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
  formatReferenceEmbeddingModel,
  installReferenceEmbeddingModel,
  REFERENCE_MODEL_FILE_SOURCES,
  REFERENCE_MODEL_ONNX_URL,
} from '../tools/model.js';

let tempDir: string;
let sharedRoot: string;

async function createModelArchive(): Promise<{
  sha256: string;
  size: number;
  fileHashes: Record<string, string>;
}> {
  const sourceRoot = path.join(tempDir, 'model-source');
  const archivePath = path.join(tempDir, 'model.tgz');
  const archiveRoot = path.join(sourceRoot, 'model');
  const fileHashes: Record<string, string> = {};

  await rm(sourceRoot, { recursive: true, force: true });
  await mkdir(archiveRoot, { recursive: true });
  for (const [sourceUrl, body] of MODEL_FILE_RESPONSES.entries()) {
    const relativePath =
      sourceUrl === REFERENCE_MODEL_ONNX_URL
        ? 'onnx/model_quantized.onnx'
        : sourceUrl.endsWith('/config.json')
          ? 'config.json'
          : sourceUrl.endsWith('/tokenizer.json')
            ? 'tokenizer.json'
            : 'tokenizer_config.json';
    const destination = path.join(archiveRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, body);
    fileHashes[relativePath] = createHash('sha256').update(body).digest('hex');
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
    ['model'],
  );

  const buffer = await readFile(archivePath);
  return {
    sha256: createHash('sha256').update(buffer).digest('hex'),
    size: buffer.length,
    fileHashes,
  };
}
const ONNX_BUFFER = Buffer.from('fake-onnx');
const MODEL_FILE_RESPONSES = new Map<string, Buffer>(
  REFERENCE_MODEL_FILE_SOURCES.map((file) => [
    file.sourceUrl,
    file.relativePath === 'config.json'
      ? Buffer.from('{}\n')
      : file.relativePath === 'tokenizer.json'
        ? Buffer.from('{"version":"1.0"}\n')
        : file.relativePath === 'tokenizer_config.json'
          ? Buffer.from('{}\n')
          : ONNX_BUFFER,
  ]),
);

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-model-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  sharedRoot = path.join(tempDir, 'shared');

  process.env.IWSDK_REFERENCE_CACHE_DIR = sharedRoot;
});

afterEach(async () => {
  delete process.env.IWSDK_REFERENCE_CACHE_DIR;
  vi.unstubAllGlobals();
  await rm(tempDir, { recursive: true, force: true });
});

describe('reference model installer', () => {
  it('downloads and installs the pinned model files', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = MODEL_FILE_RESPONSES.get(url);
      if (!body) {
        return new Response('not found', { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: {
          'content-length': String(body.length),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const installed = await installReferenceEmbeddingModel();
    const expectedArchive = await createModelArchive();

    expect(fetchMock).toHaveBeenCalledWith(REFERENCE_MODEL_ONNX_URL);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(installed.sourceUrl).toBe(REFERENCE_MODEL_ONNX_URL);
    expect(installed.metadata).toMatchObject({
      source: 'archive',
      format: 'transformers-js',
      archiveSha256: expectedArchive.sha256,
      archiveSize: expectedArchive.size,
      dtype: 'q8',
      pooling: 'mean',
      normalize: true,
    });
    expect(installed.metadata.fileHashes).toEqual(expectedArchive.fileHashes);
    expect(formatReferenceEmbeddingModel(installed.metadata)).toBe(
      `sha256:${expectedArchive.sha256}`,
    );
  });

  it('reuses the extracted cache path when the same model is downloaded again', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = MODEL_FILE_RESPONSES.get(url);
      if (!body) {
        return new Response('not found', { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: {
          'content-length': String(body.length),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstInstall = await installReferenceEmbeddingModel();
    const secondInstall = await installReferenceEmbeddingModel();

    expect(firstInstall.modelDir).toBe(secondInstall.modelDir);
    expect(secondInstall.metadata.archiveSha256).toBe(
      firstInstall.metadata.archiveSha256,
    );
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('repairs a corrupted cached model directory before reuse', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = MODEL_FILE_RESPONSES.get(url);
      if (!body) {
        return new Response('not found', { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: {
          'content-length': String(body.length),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const firstInstall = await installReferenceEmbeddingModel();
    await writeFile(
      path.join(firstInstall.modelDir, 'config.json'),
      '{"corrupt":true}\n',
      'utf8',
    );

    const repairedInstall = await installReferenceEmbeddingModel();
    const repairedConfig = await readFile(
      path.join(repairedInstall.modelDir, 'config.json'),
      'utf8',
    );

    expect(repairedInstall.modelDir).toBe(firstInstall.modelDir);
    expect(repairedConfig).toBe('{}\n');
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('fails clearly when the pinned ONNX download fails', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === REFERENCE_MODEL_ONNX_URL) {
        return new Response('not found', { status: 404 });
      }
      const body = MODEL_FILE_RESPONSES.get(url);
      if (!body) {
        return new Response('not found', { status: 404 });
      }
      return new Response(body, {
        status: 200,
        headers: {
          'content-length': String(body.length),
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(installReferenceEmbeddingModel()).rejects.toThrow(
      REFERENCE_MODEL_ONNX_URL,
    );
  });
});
