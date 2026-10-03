/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Vector search service for IWSDK code chunks
 */

import { readFileSync } from 'fs';
import path from 'path';
import { resolveReferenceAssets } from './assets.js';
import { EmbeddingService, cosineSimilarity } from './embeddings.js';
import type {
  Chunk,
  EmbeddingsData,
  RawChunk,
  ReferenceEmbeddingModelMetadata,
  SearchResult,
  RelationshipQuery,
} from './types.js';
import { isReferenceEmbeddingModelMetadata } from './types.js';

/**
 * Helper to safely convert a field to an array
 */
function toArray(value: any): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [];
}

export class SearchService {
  private chunks: Chunk[] = [];
  private embeddingService: EmbeddingService;
  private initialized = false;

  constructor() {
    this.embeddingService = new EmbeddingService();
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.error('Initializing search service...');

    const { dataDir, modelDir } = await resolveReferenceAssets();
    const embeddingsPath = path.join(dataDir, 'embeddings.json');
    let model: ReferenceEmbeddingModelMetadata | null = null;

    try {
      console.error(`Loading embeddings from ${embeddingsPath}...`);
      const data = JSON.parse(
        readFileSync(embeddingsPath, 'utf-8'),
      ) as EmbeddingsData;
      if (!isReferenceEmbeddingModelMetadata(data.model)) {
        throw new Error('Embeddings file is missing pinned model metadata.');
      }
      model = data.model;

      // Transform raw chunks into Chunk objects
      this.chunks = [
        ...data.iwsdk.map((raw, idx) =>
          this.rawChunkToChunk(raw, `iwsdk_${idx}`),
        ),
        ...data.deps.map((raw, idx) =>
          this.rawChunkToChunk(raw, `deps_${idx}`),
        ),
      ];

      console.error(
        `Loaded ${this.chunks.length} chunks using pinned model sha256 ${data.model.archiveSha256}`,
      );
      console.error(`  - iwsdk: ${data.iwsdk.length} chunks`);
      console.error(`  - deps: ${data.deps.length} chunks`);
      console.error(`  - embedding dimensions: ${data.dimensions}`);
    } catch (error) {
      throw new Error(
        `Failed to load embeddings from ${embeddingsPath}: ${error instanceof Error ? error.message : String(error)}. Rebuild @iwsdk/reference-assets if needed and rerun "iwsdk reference warmup".`,
      );
    }

    // Initialize embedding service
    await this.embeddingService.initialize({
      model: model ?? undefined,
      modelDir,
    });

    this.initialized = true;
    console.error('Search service initialized successfully');
  }

  /**
   * Transform a RawChunk from embeddings.json into a Chunk object
   */
  private rawChunkToChunk(raw: RawChunk, id: string): Chunk {
    return {
      id,
      content: raw.content,
      embedding: raw.embedding,
      metadata: {
        source: raw.source,
        file_path: raw.file_path,
        chunk_type: raw.chunk_type,
        name: raw.name,
        start_line: raw.start_line,
        end_line: raw.end_line,
        class_context: raw.class_name,
        semantic_labels: raw.semantic_labels,
        extends: raw.extends,
        implements: raw.implements,
        imports: raw.imports,
        calls: raw.calls,
        webxr_api_usage: raw.webxr_api_usage,
        ecs_component: raw.ecs_component,
        ecs_system: raw.ecs_system,
      },
    };
  }

  /**
   * Semantic search across all code chunks
   */
  async search(
    query: string,
    options: {
      limit?: number;
      source_filter?: string[];
      min_score?: number;
    } = {},
  ): Promise<SearchResult[]> {
    if (!this.initialized) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    const limit = options.limit ?? 10;
    const minScore = options.min_score ?? 0.0;

    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embed(query);

    // Filter chunks by source if specified
    let searchableChunks = this.chunks;
    if (options.source_filter && options.source_filter.length > 0) {
      searchableChunks = this.chunks.filter((chunk) =>
        options.source_filter!.includes(chunk.metadata.source),
      );
    }

    // Calculate similarity scores
    const results: SearchResult[] = searchableChunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Filter by minimum score and sort by score descending
    return results
      .filter((result) => result.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Find chunks by relationship (extends, implements, imports, calls, uses WebXR API)
   */
  findByRelationship(query: RelationshipQuery): Chunk[] {
    if (!this.initialized) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    const limit = query.limit ?? 20;
    const results: Chunk[] = [];

    for (const chunk of this.chunks) {
      let matches = false;

      switch (query.type) {
        case 'extends':
          matches = toArray(chunk.metadata.extends).some((e) =>
            e.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'implements':
          matches = toArray(chunk.metadata.implements).some((i) =>
            i.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'imports':
          matches = toArray(chunk.metadata.imports).some((imp) =>
            imp.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'calls':
          matches = toArray(chunk.metadata.calls).some((call) =>
            call.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;

        case 'uses_webxr_api':
          matches = toArray(chunk.metadata.webxr_api_usage).some((api) =>
            api.toLowerCase().includes(query.target.toLowerCase()),
          );
          break;
      }

      if (matches) {
        results.push(chunk);
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Get a specific chunk by name (for API reference lookups)
   */
  getByName(
    name: string,
    options: {
      chunk_type?: string;
      source_filter?: string[];
    } = {},
  ): Chunk[] {
    if (!this.initialized) {
      throw new Error(
        'Search service not initialized. Call initialize() first.',
      );
    }

    let results = this.chunks.filter((chunk) =>
      chunk.metadata.name.toLowerCase().includes(name.toLowerCase()),
    );

    if (options.chunk_type) {
      results = results.filter(
        (chunk) => chunk.metadata.chunk_type === options.chunk_type,
      );
    }

    if (options.source_filter && options.source_filter.length > 0) {
      results = results.filter((chunk) =>
        options.source_filter!.includes(chunk.metadata.source),
      );
    }

    return results;
  }

  /**
   * Get statistics about the indexed data
   */
  getStats(): {
    total_chunks: number;
    by_source: Record<string, number>;
    by_type: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const chunk of this.chunks) {
      bySource[chunk.metadata.source] =
        (bySource[chunk.metadata.source] ?? 0) + 1;
      byType[chunk.metadata.chunk_type] =
        (byType[chunk.metadata.chunk_type] ?? 0) + 1;
    }

    return {
      total_chunks: this.chunks.length,
      by_source: bySource,
      by_type: byType,
    };
  }

  /**
   * Get all chunks (for advanced filtering in tools)
   */
  getAllChunks(): Chunk[] {
    return this.chunks;
  }
}
