#!/usr/bin/env node --no-warnings
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Verify that the live @iwsdk/reference CLI + MCP surfaces stay aligned with
 * the exported reference contract.
 *
 * Preferred entrypoint:
 *   pnpm test:reference-cli-mcp-parity
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REFERENCE_CLI_PATH = path.join(
  ROOT,
  'packages',
  'reference',
  'dist',
  'cli.js',
);
const REFERENCE_CONTRACT_PATH = path.join(
  ROOT,
  'packages',
  'reference',
  'dist',
  'contract.js',
);
const referencePackageRequire = createRequire(
  path.join(ROOT, 'packages', 'reference', 'package.json'),
);

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stable(entry)]),
    );
  }
  return value;
}

async function runReferenceCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [REFERENCE_CLI_PATH, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      if ((exitCode ?? 1) !== 0) {
        reject(
          new Error(
            `reference CLI failed with exit ${exitCode ?? 1}\n${
              stderr || stdout
            }`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `Failed to parse reference CLI JSON:\n${stderr || stdout || String(error)}`,
          ),
        );
      }
    });
  });
}

async function loadReferenceContract() {
  return import(pathToFileURL(REFERENCE_CONTRACT_PATH).href);
}

async function listReferenceMcpTools() {
  const { Client } = referencePackageRequire(
    '@modelcontextprotocol/sdk/client/index.js',
  );
  const { StdioClientTransport } = referencePackageRequire(
    '@modelcontextprotocol/sdk/client/stdio.js',
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [REFERENCE_CLI_PATH],
    cwd: ROOT,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => process.stderr.write(chunk));

  const client = new Client({
    name: 'reference-cli-mcp-parity',
    version: '1.0.0',
  });
  await client.connect(transport);

  try {
    const listed = await client.listTools();
    return listed.tools;
  } finally {
    await transport.close();
  }
}

async function main() {
  const contract = await loadReferenceContract();
  const inspectPayload = await runReferenceCli(['--inspect-json']);
  assert.equal(
    inspectPayload.ok,
    true,
    'inspect surface returned a failure envelope',
  );

  const expectedOperations = contract.REFERENCE_OPERATIONS.map((operation) => ({
    id: operation.id,
    cliName: operation.cliName,
    handlerId: operation.handlerId,
    mcpName: operation.mcpName,
    description: operation.description,
    inputSchema: operation.inputSchema,
    requiresSearchService: operation.requiresSearchService,
  }));
  assert.deepEqual(
    stable(inspectPayload.data.operations),
    stable(expectedOperations),
    'CLI inspect surface does not match the exported reference contract',
  );

  const listedTools = await listReferenceMcpTools();
  assert.deepEqual(
    stable(
      listedTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    ),
    stable(contract.REFERENCE_MCP_TOOLS),
    'MCP tool list does not match the exported reference contract',
  );

  console.log('Reference CLI/MCP parity verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
