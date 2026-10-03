/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Generate embeddings from parsed chunks using the pinned reference model
 * files downloaded by the producer cache.
 *
 * Usage:
 *   node dist-tools/tools/generate-embeddings.js <chunks-file> <output-file>
 */

import { readFileSync, writeFileSync } from 'fs';
import { env, pipeline } from '@huggingface/transformers';
import {
  formatReferenceEmbeddingModel,
  installReferenceEmbeddingModel,
} from './model.js';

interface Chunk {
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
  source?: string;
}

interface ChunkWithEmbedding extends Chunk {
  embedding: number[];
}

class ProducerEmbeddingService {
  private extractor: any = null;

  async initialize(): Promise<void> {
    if (this.extractor) {
      return;
    }

    try {
      const installedModel = await installReferenceEmbeddingModel();
      env.allowLocalModels = true;
      (env as { allowRemoteModels?: boolean }).allowRemoteModels = false;
      console.error(
        `Loading embedding model from warmed cache ${formatReferenceEmbeddingModel(installedModel.metadata)}...`,
      );
      this.extractor = await pipeline(
        'feature-extraction',
        installedModel.modelDir,
        {
          dtype: installedModel.metadata.dtype,
          local_files_only: true,
        },
      );
      console.error('Embedding model loaded successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize the reference embedding model. ${message}`,
      );
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.extractor) {
      throw new Error(
        'Embedding service not initialized. Call initialize() first.',
      );
    }

    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data as Float32Array);
  }
}

function createChunkText(chunk: Chunk): string {
  const parts: string[] = [];
  parts.push(`# ${chunk.chunk_type}: ${chunk.name}`);

  if (chunk.file_path) {
    const pathParts = chunk.file_path.split('/');
    const srcIdx = pathParts.indexOf('src');
    if (srcIdx !== -1) {
      parts.push(`File: ${pathParts.slice(srcIdx).join('/')}`);
    }
  }

  if (chunk.class_name) {
    parts.push(`Class: ${chunk.class_name}`);
  }
  if (chunk.module_path) {
    parts.push(`Module: ${chunk.module_path}`);
  }
  if (chunk.semantic_labels && chunk.semantic_labels.length > 0) {
    parts.push(`Labels: ${chunk.semantic_labels.sort().join(', ')}`);
  }

  parts.push(`Language: ${chunk.language}`);

  if (chunk.extends && chunk.extends.length > 0) {
    parts.push(`Extends: ${chunk.extends.sort().join(', ')}`);
  }
  if (chunk.implements && chunk.implements.length > 0) {
    parts.push(`Implements: ${chunk.implements.sort().join(', ')}`);
  }

  if (chunk.imports && chunk.imports.length > 0) {
    const moduleNames: string[] = [];
    for (const entry of chunk.imports.slice(0, 5)) {
      if (entry.includes('from')) {
        const parts = entry.split('from');
        if (parts.length > 1) {
          moduleNames.push(parts[1].trim().replace(/[';\"]/g, ''));
        }
      } else if (entry.includes('import')) {
        moduleNames.push(
          entry
            .replace('import', '')
            .trim()
            .replace(/[';\"]/g, ''),
        );
      }
    }
    if (moduleNames.length > 0) {
      parts.push(`Imports from: ${moduleNames.slice(0, 5).join(', ')}`);
    }
  }

  if (chunk.calls && chunk.calls.length > 0) {
    parts.push(
      `Calls: ${Array.from(chunk.calls).sort().slice(0, 10).join(', ')}`,
    );
  }
  if (chunk.webxr_api_usage && chunk.webxr_api_usage.length > 0) {
    parts.push(`Uses WebXR APIs: ${chunk.webxr_api_usage.sort().join(', ')}`);
  }
  if (chunk.ecs_component) {
    parts.push('Pattern: ECS Component');
  }
  if (chunk.ecs_system) {
    parts.push('Pattern: ECS System');
  }

  parts.push('');
  parts.push(chunk.content);
  return parts.join('\n');
}

async function generateEmbeddings(
  chunks: Chunk[],
  batchSize = 50,
): Promise<ChunkWithEmbedding[]> {
  const embedder = new ProducerEmbeddingService();
  console.error('🔄 Initializing the pinned reference embedding model...');
  await embedder.initialize();
  console.error('✅ Model initialized\n');

  const results: ChunkWithEmbedding[] = [];
  const total = chunks.length;
  console.error(`🧠 Generating embeddings for ${total} chunks...`);
  console.error(`   Batch size: ${batchSize}\n`);

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, Math.min(i + batchSize, chunks.length));
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);
    console.error(
      `📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)...`,
    );

    for (const chunk of batch) {
      const embedding = await embedder.embed(createChunkText(chunk));
      results.push({
        ...chunk,
        embedding,
      });
    }

    const progress = Math.round((results.length / total) * 100);
    console.error(`   Progress: ${results.length}/${total} (${progress}%)\n`);
  }

  console.error('✅ All embeddings generated!\n');
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      'Usage: node dist-tools/tools/generate-embeddings.js <chunks-file> <output-file>',
    );
    process.exit(1);
  }

  const [chunksFile, outputFile] = args;
  console.error('='.repeat(70));
  console.error('🚀 GENERATING EMBEDDINGS (Node.js)');
  console.error('='.repeat(70));
  console.error(`📂 Input:  ${chunksFile}`);
  console.error(`📂 Output: ${outputFile}`);
  console.error('');

  try {
    console.error('📖 Reading chunks...');
    const chunks = JSON.parse(readFileSync(chunksFile, 'utf-8')) as Chunk[];
    console.error(`✅ Loaded ${chunks.length} chunks\n`);

    const chunksWithEmbeddings = await generateEmbeddings(chunks);

    console.error('💾 Writing embeddings to file...');
    writeFileSync(outputFile, JSON.stringify(chunksWithEmbeddings, null, 2));
    console.error(`✅ Written to ${outputFile}\n`);
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
