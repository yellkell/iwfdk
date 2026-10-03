/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Semantic code chunker.
 *
 * ts-morph already gives us clean semantic chunks, so we just sort them.
 */

import { TypeScriptChunk } from './types.js';

export interface ChunkingConfig {
  minChunkSize: number;
  maxChunkSize: number;
  targetChunkSize: number;
}

export class ASTChunker {
  private config: ChunkingConfig;

  constructor(config?: Partial<ChunkingConfig>) {
    this.config = {
      minChunkSize: config?.minChunkSize ?? 15,
      maxChunkSize: config?.maxChunkSize ?? 100,
      targetChunkSize: config?.targetChunkSize ?? 50,
    };

    console.error(
      `✅ AST Chunker initialized (min=${this.config.minChunkSize}, ` +
        `max=${this.config.maxChunkSize}, target=${this.config.targetChunkSize})`,
    );
  }

  optimizeChunks(chunks: TypeScriptChunk[]): TypeScriptChunk[] {
    if (chunks.length === 0) {
      return chunks;
    }

    const byFile = new Map<string, TypeScriptChunk[]>();
    for (const chunk of chunks) {
      if (!byFile.has(chunk.file_path)) {
        byFile.set(chunk.file_path, []);
      }
      byFile.get(chunk.file_path)!.push(chunk);
    }

    const optimized: TypeScriptChunk[] = [];
    for (const [, fileChunks] of byFile) {
      fileChunks.sort((a, b) => a.start_line - b.start_line);
      optimized.push(...fileChunks);
    }

    return optimized;
  }
}
