/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { existsSync } from 'fs';
import path from 'path';
import type { ResolvedCliIo } from './cli-types.js';
import {
  normalizeWorkspaceRoot,
  resolveWorkspaceRoot,
} from './runtime-state.js';

export function getReferencePackageRoot(workspaceRoot: string): string {
  return path.join(
    normalizeWorkspaceRoot(workspaceRoot),
    'node_modules',
    '@iwsdk',
    'reference',
  );
}

function getReferenceCliEntrypoint(workspaceRoot: string): string {
  return path.join(getReferencePackageRoot(workspaceRoot), 'dist', 'cli.js');
}

function getReferenceLegacyEntrypoint(workspaceRoot: string): string {
  return path.join(getReferencePackageRoot(workspaceRoot), 'dist', 'index.js');
}

export function getReferenceEntrypoint(workspaceRoot: string): string {
  const cliEntrypoint = getReferenceCliEntrypoint(workspaceRoot);
  if (existsSync(cliEntrypoint)) {
    return cliEntrypoint;
  }
  return getReferenceLegacyEntrypoint(workspaceRoot);
}

export function hasReferenceInstalled(workspaceRoot: string): boolean {
  return (
    existsSync(getReferenceCliEntrypoint(workspaceRoot)) ||
    existsSync(getReferenceLegacyEntrypoint(workspaceRoot))
  );
}

export async function resolveReferenceWorkspaceRoot(
  options: Record<string, unknown>,
  context: ResolvedCliIo,
): Promise<string> {
  const workspace =
    typeof options.workspace === 'string' ? options.workspace : undefined;
  return resolveWorkspaceRoot({
    cwd: context.cwd,
    workspace,
    requireRunning: false,
  });
}
