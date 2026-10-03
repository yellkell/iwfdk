/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceEmbeddingModelMetadata } from '../src/types.js';

const pipelineMock = vi.fn();
const envMock: { allowLocalModels?: boolean; allowRemoteModels?: boolean } = {};

vi.mock('@huggingface/transformers', () => ({
  pipeline: pipelineMock,
  env: envMock,
}));

const TEST_MODEL: ReferenceEmbeddingModelMetadata = {
  source: 'archive',
  format: 'transformers-js',
  archiveSha256: 'model-hash',
  archiveSize: 123,
  dtype: 'q8',
  pooling: 'mean',
  normalize: true,
};

let tempDir: string;
let modelDir: string;

beforeEach(async () => {
  pipelineMock.mockReset();
  envMock.allowLocalModels = false;
  envMock.allowRemoteModels = true;

  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-embeddings-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  modelDir = path.join(tempDir, 'model');
  await mkdir(path.join(modelDir, 'onnx'), { recursive: true });
  await writeFile(path.join(modelDir, 'config.json'), '{}\n', 'utf8');
  await writeFile(path.join(modelDir, 'tokenizer.json'), '{}\n', 'utf8');
  await writeFile(path.join(modelDir, 'tokenizer_config.json'), '{}\n', 'utf8');
  await writeFile(
    path.join(modelDir, 'onnx', 'model_quantized.onnx'),
    'onnx',
    'utf8',
  );
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('EmbeddingService', () => {
  it('initializes transformers with the warmed local model once', async () => {
    const extractor = vi
      .fn()
      .mockResolvedValue({ data: Float32Array.from([1, 0, 0]) });
    pipelineMock.mockResolvedValue(extractor);

    const { EmbeddingService } = await import('../src/embeddings.js');
    const service = new EmbeddingService();

    await service.initialize({ model: TEST_MODEL, modelDir });
    await service.initialize({ model: TEST_MODEL, modelDir });
    const embedding = await service.embed('player rig');

    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith(
      'feature-extraction',
      modelDir,
      expect.objectContaining({
        dtype: TEST_MODEL.dtype,
        local_files_only: true,
      }),
    );
    expect(extractor).toHaveBeenCalledWith('player rig', {
      pooling: TEST_MODEL.pooling,
      normalize: TEST_MODEL.normalize,
    });
    expect(embedding).toEqual([1, 0, 0]);
    expect(envMock.allowLocalModels).toBe(true);
    expect(envMock.allowRemoteModels).toBe(false);
  });
});
