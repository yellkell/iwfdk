/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import path from 'path';
import modelContract from './model-contract.json';
import type { ReferenceEmbeddingModelMetadata } from './types.js';

interface PinnedReferenceModelFileSource {
  relativePath: string;
  sourceUrl: string;
}

interface PinnedReferenceModelContract {
  source: ReferenceEmbeddingModelMetadata['source'];
  format: ReferenceEmbeddingModelMetadata['format'];
  repoId: string;
  revision: string;
  dtype: ReferenceEmbeddingModelMetadata['dtype'];
  pooling: ReferenceEmbeddingModelMetadata['pooling'];
  normalize: ReferenceEmbeddingModelMetadata['normalize'];
  files: PinnedReferenceModelFileSource[];
}

const PINNED_REFERENCE_MODEL_CONTRACT =
  modelContract as PinnedReferenceModelContract;
const REFERENCE_MODEL_ONNX_PATH = 'onnx/model_quantized.onnx';

export const REFERENCE_MODEL_REPO_ID = PINNED_REFERENCE_MODEL_CONTRACT.repoId;
export const REFERENCE_MODEL_REVISION =
  PINNED_REFERENCE_MODEL_CONTRACT.revision;
export const REFERENCE_MODEL_ONNX_URL =
  PINNED_REFERENCE_MODEL_CONTRACT.files.find(
    (file) => file.relativePath === REFERENCE_MODEL_ONNX_PATH,
  )?.sourceUrl ?? '';
export const REFERENCE_MODEL_FILE_SOURCES = Object.freeze(
  PINNED_REFERENCE_MODEL_CONTRACT.files.map((file) => ({
    relativePath: file.relativePath,
    sourceUrl: file.sourceUrl,
  })),
);
export const REQUIRED_MODEL_FILES = Object.freeze(
  REFERENCE_MODEL_FILE_SOURCES.map((file) => file.relativePath),
);
export const DEFAULT_REFERENCE_MODEL_SETTINGS = Object.freeze({
  source: PINNED_REFERENCE_MODEL_CONTRACT.source,
  format: PINNED_REFERENCE_MODEL_CONTRACT.format,
  dtype: PINNED_REFERENCE_MODEL_CONTRACT.dtype,
  pooling: PINNED_REFERENCE_MODEL_CONTRACT.pooling,
  normalize: PINNED_REFERENCE_MODEL_CONTRACT.normalize,
});

export function buildReferenceEmbeddingModelMetadata(
  archiveSha256: string,
  archiveSize: number,
  fileHashes?: Record<string, string>,
): ReferenceEmbeddingModelMetadata {
  return {
    ...DEFAULT_REFERENCE_MODEL_SETTINGS,
    archiveSha256,
    archiveSize,
    ...(fileHashes ? { fileHashes } : {}),
  };
}

export function hasReferenceEmbeddingModelFiles(
  modelDir: string | null,
): boolean {
  if (!modelDir) {
    return false;
  }

  return REQUIRED_MODEL_FILES.every((relativePath) =>
    existsSync(path.join(modelDir, relativePath)),
  );
}

export function formatReferenceEmbeddingModel(
  model: ReferenceEmbeddingModelMetadata,
): string {
  return `sha256:${model.archiveSha256}`;
}
