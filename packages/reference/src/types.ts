/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Type definitions for IWSDK Reference MCP Server
 */

export interface ChunkMetadata {
  source: string;
  file_path: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  class_context?: string;
  semantic_labels?: string[];
  extends?: string[];
  implements?: string[];
  imports?: string[];
  calls?: string[];
  webxr_api_usage?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
}

export interface Chunk {
  id: string;
  content: string;
  metadata: ChunkMetadata;
  embedding: number[];
}

// Raw chunk format from embeddings.json (flattened structure)
export interface RawChunk {
  content: string;
  chunk_type: string;
  name: string;
  start_line: number;
  end_line: number;
  file_path: string;
  language: string;
  module_path?: string;
  class_name?: string;
  imports?: string[];
  exports?: string[];
  type_parameters?: string[];
  decorators?: string[];
  calls?: string[];
  extends?: string[];
  implements?: string[];
  uses_types?: string[];
  ecs_component?: boolean;
  ecs_system?: boolean;
  webxr_api_usage?: string[];
  three_js_usage?: string[];
  semantic_labels?: string[];
  source: string;
  embedding: number[];
}

export type ReferenceEmbeddingModelDType =
  | 'auto'
  | 'fp32'
  | 'fp16'
  | 'q8'
  | 'int8'
  | 'uint8'
  | 'q4'
  | 'bnb4'
  | 'q4f16';

export interface ReferenceEmbeddingModelMetadata {
  source: 'archive';
  format: 'transformers-js';
  archiveSha256: string;
  archiveSize: number;
  fileHashes?: Record<string, string>;
  dtype: ReferenceEmbeddingModelDType;
  pooling: string;
  normalize: boolean;
}

// Embeddings.json format
export interface EmbeddingsData {
  version: string;
  model: ReferenceEmbeddingModelMetadata;
  dimensions: number;
  iwsdk: RawChunk[];
  deps: RawChunk[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

export interface RelationshipQuery {
  type: 'extends' | 'implements' | 'imports' | 'calls' | 'uses_webxr_api';
  target: string;
  limit?: number;
}

export function isReferenceEmbeddingModelMetadata(
  value: unknown,
): value is ReferenceEmbeddingModelMetadata {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('source' in value) ||
    value.source !== 'archive' ||
    !('format' in value) ||
    value.format !== 'transformers-js' ||
    !('archiveSha256' in value) ||
    typeof value.archiveSha256 !== 'string' ||
    value.archiveSha256.length === 0 ||
    !('archiveSize' in value) ||
    typeof value.archiveSize !== 'number' ||
    !Number.isFinite(value.archiveSize) ||
    value.archiveSize <= 0 ||
    !('dtype' in value) ||
    typeof value.dtype !== 'string' ||
    value.dtype.length === 0 ||
    !('pooling' in value) ||
    typeof value.pooling !== 'string' ||
    value.pooling.length === 0 ||
    !('normalize' in value) ||
    typeof value.normalize !== 'boolean'
  ) {
    return false;
  }

  if ('fileHashes' in value && value.fileHashes != null) {
    if (
      typeof value.fileHashes !== 'object' ||
      Array.isArray(value.fileHashes)
    ) {
      return false;
    }
  }

  return true;
}
