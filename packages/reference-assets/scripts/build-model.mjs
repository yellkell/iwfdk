#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeModelFileHashes,
  createDeterministicModelArchive,
  downloadPinnedModelFile,
  REFERENCE_MODEL_FILE_SOURCES,
  REQUIRED_MODEL_FILES,
  sha256File,
} from '../pinned-model.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const outputRoot = path.join(packageRoot, 'model-dist');
const ALLOW_MISSING = process.argv.includes('--if-ready');

async function populateSourceDir(stagingRoot) {
  const sourceDir = path.join(stagingRoot, 'model');
  for (const file of REFERENCE_MODEL_FILE_SOURCES) {
    await downloadPinnedModelFile(
      file.sourceUrl,
      path.join(sourceDir, file.relativePath),
    );
  }
  return sourceDir;
}

async function populateUploadDir(sourceDir) {
  const uploadDir = path.join(outputRoot, 'rag');
  await fsp.mkdir(uploadDir, { recursive: true });

  for (const file of REFERENCE_MODEL_FILE_SOURCES) {
    const sourcePath = path.join(sourceDir, file.relativePath);
    const uploadPath = path.join(uploadDir, path.basename(file.relativePath));
    await fsp.copyFile(sourcePath, uploadPath);
  }

  return uploadDir;
}

async function main() {
  const packageJson = JSON.parse(
    await fsp.readFile(path.join(packageRoot, 'package.json'), 'utf8'),
  );

  await fsp.rm(outputRoot, { recursive: true, force: true });
  await fsp.mkdir(outputRoot, { recursive: true });
  const stagingRoot = path.join(outputRoot, '.staging');

  try {
    await fsp.rm(stagingRoot, { recursive: true, force: true });
    const sourceDir = await populateSourceDir(stagingRoot);

    for (const relativePath of REQUIRED_MODEL_FILES) {
      await fsp.access(path.join(sourceDir, relativePath));
    }

    await populateUploadDir(sourceDir);

    const archivePath = path.join(outputRoot, 'model.tgz');
    await createDeterministicModelArchive(sourceDir, archivePath);

    const archiveStat = await fsp.stat(archivePath);
    const archiveSha256 = await sha256File(archivePath);
    const fileHashes = await computeModelFileHashes(sourceDir);
    const manifest = {
      schemaVersion: 1,
      referenceVersion: packageJson.version,
      generatedAt: new Date().toISOString(),
      model: {
        file: 'model.tgz',
        sha256: archiveSha256,
        size: archiveStat.size,
        format: 'transformers-js',
        requiredFiles: REQUIRED_MODEL_FILES,
        fileHashes,
      },
    };

    await fsp.writeFile(
      path.join(outputRoot, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await fsp.writeFile(
      path.join(outputRoot, 'model.tgz.sha256'),
      `${archiveSha256}  model.tgz\n`,
      'utf8',
    );

    process.stdout.write(
      `Built reference model artifact in ${outputRoot} (${archiveStat.size} B model, upload folder: rag/)\n`,
    );
  } catch (error) {
    if (ALLOW_MISSING) {
      process.stdout.write(
        'Skipping model packaging because the pinned model files are not reachable.\n',
      );
      await fsp.rm(outputRoot, { recursive: true, force: true });
      return;
    }
    throw error;
  } finally {
    await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(
    `Failed to build reference model artifact: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exit(1);
});
