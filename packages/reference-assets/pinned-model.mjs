/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readFileSync,
} from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import * as tar from 'tar';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const referencePackageRoot = path.resolve(__dirname, '..', 'reference', 'src');
const modelContractPath = path.join(
  referencePackageRoot,
  'model-contract.json',
);
const contract = JSON.parse(readFileSync(modelContractPath, 'utf8'));
const REFERENCE_MODEL_ONNX_PATH = 'onnx/model_quantized.onnx';

const DEFAULT_REFERENCE_MODEL_SETTINGS = Object.freeze({
  source: contract.source,
  format: contract.format,
  dtype: contract.dtype,
  pooling: contract.pooling,
  normalize: contract.normalize,
});

export const REFERENCE_MODEL_REPO_ID = contract.repoId;
export const REFERENCE_MODEL_REVISION = contract.revision;
export const REFERENCE_MODEL_FILE_SOURCES = Object.freeze(
  contract.files.map((file) => ({
    relativePath: file.relativePath,
    sourceUrl: file.sourceUrl,
  })),
);
export const REFERENCE_MODEL_ONNX_URL =
  REFERENCE_MODEL_FILE_SOURCES.find(
    (file) => file.relativePath === REFERENCE_MODEL_ONNX_PATH,
  )?.sourceUrl ?? '';
export const REQUIRED_MODEL_FILES = Object.freeze(
  REFERENCE_MODEL_FILE_SOURCES.map((file) => file.relativePath),
);

export function buildReferenceEmbeddingModelMetadata(
  archiveSha256,
  archiveSize,
  fileHashes,
) {
  return {
    ...DEFAULT_REFERENCE_MODEL_SETTINGS,
    archiveSha256,
    archiveSize,
    ...(fileHashes ? { fileHashes } : {}),
  };
}

export function formatReferenceEmbeddingModel(model) {
  return `sha256:${model.archiveSha256}`;
}

export function hasReferenceEmbeddingModelFiles(modelDir) {
  if (!modelDir) {
    return false;
  }

  return REQUIRED_MODEL_FILES.every((relativePath) =>
    existsSync(path.join(modelDir, relativePath)),
  );
}

export async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function computeModelFileHashes(modelDir) {
  const hashes = {};
  for (const file of REFERENCE_MODEL_FILE_SOURCES) {
    hashes[file.relativePath] = await sha256File(
      path.join(modelDir, file.relativePath),
    );
  }
  return hashes;
}

async function writeResponseToFile(response, destination, sourceUrl) {
  if (!response.body) {
    throw new Error(`No response body received from ${sourceUrl}`);
  }

  const fileStream = createWriteStream(destination);
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      if (!fileStream.write(chunk)) {
        await new Promise((resolve) => fileStream.once('drain', resolve));
      }
    }

    fileStream.end();
    await new Promise((resolve, reject) => {
      fileStream.once('finish', resolve);
      fileStream.once('error', reject);
    });
  } catch (error) {
    fileStream.destroy();
    throw error;
  }
}

export async function downloadPinnedModelFile(
  sourceUrl,
  destination,
  expected = {},
) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });

  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch ${sourceUrl}: HTTP ${response.status}`);
    }
    await writeResponseToFile(response, destination, sourceUrl);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Unable to fetch ${sourceUrl}: HTTP `)
    ) {
      throw error;
    }
    await fsp.rm(destination, { force: true }).catch(() => {});
    const curlResult = spawnSync(
      'curl',
      [
        '-L',
        '--fail',
        '--silent',
        '--show-error',
        sourceUrl,
        '--output',
        destination,
      ],
      {
        encoding: 'utf8',
      },
    );
    if (curlResult.status !== 0) {
      throw new Error(
        `Unable to fetch ${sourceUrl}: ${
          curlResult.stderr?.trim() ||
          (error instanceof Error ? error.message : String(error))
        }`,
      );
    }
  }

  const downloaded = await fsp.stat(destination);
  if (
    typeof expected.size === 'number' &&
    Number.isFinite(expected.size) &&
    downloaded.size !== expected.size
  ) {
    throw new Error(
      `Size mismatch for ${sourceUrl}: expected ${expected.size}, got ${downloaded.size}`,
    );
  }
  if (expected.sha256) {
    const actualSha = await sha256File(destination);
    if (actualSha !== expected.sha256) {
      throw new Error(
        `Checksum mismatch for ${sourceUrl}: expected ${expected.sha256}, got ${actualSha}`,
      );
    }
  }
}

export async function createDeterministicModelArchive(sourceDir, archivePath) {
  await tar.c(
    {
      cwd: path.dirname(sourceDir),
      file: archivePath,
      gzip: true,
      portable: true,
      noPax: true,
      mtime: new Date(0),
    },
    [path.basename(sourceDir)],
  );
}
