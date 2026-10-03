/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Embedding service using transformers.js against a warmed local model cache.
 */

import { env, pipeline } from '@huggingface/transformers';
import { resolveReferenceAssets } from './assets.js';
import { hasReferenceEmbeddingModelFiles } from './model-contract.js';
import type { ReferenceEmbeddingModelMetadata } from './types.js';

export class EmbeddingService {
  private extractor: any = null;
  private model: ReferenceEmbeddingModelMetadata | null = null;

  getModelName(): string {
    return this.model?.archiveSha256 ?? '';
  }

  async initialize(
    options: {
      model?: ReferenceEmbeddingModelMetadata;
      modelDir?: string;
    } = {},
  ): Promise<void> {
    if (this.extractor) {
      return;
    }

    const resolvedAssets =
      options.model && options.modelDir ? null : await resolveReferenceAssets();
    const model = options.model ?? resolvedAssets?.model;
    const localModelDir = options.modelDir ?? resolvedAssets?.modelDir;
    if (!model || !localModelDir) {
      throw new Error(
        'Reference embedding model metadata is unavailable. Run "iwsdk reference warmup" again.',
      );
    }

    if (!hasReferenceEmbeddingModelFiles(localModelDir)) {
      throw new Error(
        `Reference model directory ${localModelDir} is incomplete. Run "iwsdk reference warmup" again to refresh the pinned model files.`,
      );
    }

    env.allowLocalModels = true;
    (env as { allowRemoteModels?: boolean }).allowRemoteModels = false;
    this.model = model;
    try {
      console.error(
        `Loading reference embedding model from warmed cache ${localModelDir} (sha256 ${model.archiveSha256})...`,
      );
      this.extractor = await pipeline('feature-extraction', localModelDir, {
        dtype: model.dtype,
        local_files_only: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to load the warmed reference embedding model from ${localModelDir}. Ensure "iwsdk reference warmup" completed successfully. Original error: ${message}`,
      );
    }
    console.error('Embedding model loaded successfully');
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      throw new Error(
        'Embedding service not initialized. Call initialize() first.',
      );
    }

    const output = await this.extractor(text, {
      pooling: this.model?.pooling ?? 'mean',
      normalize: this.model?.normalize ?? true,
    });

    return Array.from(output.data as Float32Array);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.extractor) {
      throw new Error(
        'Embedding service not initialized. Call initialize() first.',
      );
    }

    const embeddings: number[][] = [];
    for (const text of texts) {
      const embedding = await this.embed(text);
      embeddings.push(embedding);
    }

    return embeddings;
  }
}

// Cosine similarity calculation
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
