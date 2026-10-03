/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

export function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = resolve(dir, '..');
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

export const PACKAGE_ROOT = findPackageRoot();

function isInsideNodeModules(dir: string): boolean {
  return dir.split(/[\\/]/).includes('node_modules');
}

export function findReferenceWorkspaceRoot(
  startDir = resolve(
    process.env.IWSDK_REFERENCE_WORKSPACE_ROOT ??
      process.env.INIT_CWD ??
      process.cwd(),
  ),
): string {
  let dir = startDir;
  let nearestPackageRoot: string | null = null;

  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }

    if (!isInsideNodeModules(dir) && existsSync(join(dir, 'package.json'))) {
      nearestPackageRoot ??= dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  if (nearestPackageRoot) {
    return nearestPackageRoot;
  }

  let packageAncestor = PACKAGE_ROOT;
  while (true) {
    const parent = dirname(packageAncestor);
    if (parent === packageAncestor) {
      break;
    }

    if (existsSync(join(packageAncestor, 'pnpm-workspace.yaml'))) {
      return packageAncestor;
    }

    if (
      existsSync(join(packageAncestor, 'package.json')) &&
      !isInsideNodeModules(packageAncestor)
    ) {
      nearestPackageRoot ??= packageAncestor;
    }

    if (parent.split(/[\\/]/).at(-1) === 'node_modules') {
      return dirname(parent);
    }
    packageAncestor = parent;
  }

  return nearestPackageRoot ?? PACKAGE_ROOT;
}
