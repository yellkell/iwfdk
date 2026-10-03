#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

export function getReferencePayloadBuildInputs({ root = packageRoot } = {}) {
  const resolvedRoot = path.resolve(root);
  const embeddingsPath = path.join(resolvedRoot, 'data', 'embeddings.json');
  const hasEmbeddingsData = existsSync(embeddingsPath);

  return {
    root: resolvedRoot,
    embeddingsPath,
    hasEmbeddingsData,
    canRunIngest: true,
  };
}

export function describeMissingPayloadInputs() {
  return (
    'Reference payload generation downloads the pinned reference model automatically. ' +
    'If you only need packaging flows to continue when no existing data payload is present, use build:payload:if-ready.'
  );
}

function runCommand(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const allowMissing = argv.includes('--if-ready');
  const initialInputs = getReferencePayloadBuildInputs();

  if (allowMissing && !initialInputs.hasEmbeddingsData) {
    process.stdout.write(
      'Skipping reference payload build because no existing data payload is available yet.\n',
    );
    return;
  }

  runCommand('pnpm', ['run', 'ingest']);
  runCommand(process.execPath, ['./scripts/build-assets.mjs']);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `Failed to build reference payload: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exit(1);
  });
}
