/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  describeMissingPayloadInputs,
  getReferencePayloadBuildInputs,
} from '../scripts/build-payload.mjs';

let tempDir: string;
let packageRoot: string;

beforeEach(async () => {
  tempDir = path.join(
    os.tmpdir(),
    `iwsdk-reference-assets-build-payload-test-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`,
  );
  packageRoot = path.join(tempDir, 'reference-assets');
  await mkdir(packageRoot, { recursive: true });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('reference payload build readiness', () => {
  it('can always run ingest against the pinned model URLs', () => {
    const inputs = getReferencePayloadBuildInputs({
      root: packageRoot,
    });

    expect(inputs.hasEmbeddingsData).toBe(false);
    expect(inputs.canRunIngest).toBe(true);
    expect(describeMissingPayloadInputs()).toContain('build:payload:if-ready');
  });

  it('detects an existing embeddings payload for if-ready flows', async () => {
    const embeddingsPath = path.join(packageRoot, 'data', 'embeddings.json');
    await mkdir(path.dirname(embeddingsPath), { recursive: true });
    await writeFile(embeddingsPath, '{}\n', 'utf8');

    const inputs = getReferencePayloadBuildInputs({
      root: packageRoot,
    });

    expect(inputs.hasEmbeddingsData).toBe(true);
    expect(inputs.canRunIngest).toBe(true);
  });
});
