/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getReferenceCacheStatus,
  getReferencePackageVersion,
  type ReferenceCacheStatus,
  type ReferenceWarmupEvent,
  warmupReferenceAssets,
} from './assets.js';
import {
  REFERENCE_MCP_TOOLS,
  REFERENCE_OPERATIONS,
  getReferenceOperationByCliName,
  getReferenceOperationByMcpName,
  type ReferenceOperationDefinition,
} from './contract.js';
import { FileService } from './files.js';
import { executeReferenceOperation } from './query-handlers.js';
import { SearchService } from './search.js';
import {
  findByRelationship,
  findDependents,
  findUsageExamples,
  getApiReference,
  getFileContent,
  listEcsComponents,
  listEcsSystems,
  searchCode,
} from './tools.js';

type CliOptionValue = string | boolean;
type CliOptions = Record<string, CliOptionValue>;
type CommandEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface ParsedArgv {
  positionals: string[];
  options: CliOptions;
}

const searchService = new SearchService();
const fileService = new FileService();

function toCamelCase(flagName: string): string {
  return flagName.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function parseArgv(argv: string[]): ParsedArgv {
  const positionals: string[] = [];
  const options: CliOptions = {};

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const rawKey = token.slice(2);
    const key = toCamelCase(rawKey);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index++;
      continue;
    }
    options[key] = true;
  }

  return { positionals, options };
}

function safeJsonParse<T = unknown>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${String(error)}`);
  }
}

function writeEnvelope<T>(payload: CommandEnvelope<T>) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

let progressLineActive = false;

function clearProgressLine() {
  if (!progressLineActive || !process.stderr.isTTY) {
    return;
  }
  process.stderr.write('\n');
  progressLineActive = false;
}

function renderWarmupEvent(event: ReferenceWarmupEvent) {
  if (
    event.phase === 'downloading' &&
    event.completedBytes !== undefined &&
    !process.stderr.isTTY
  ) {
    return;
  }

  if (
    event.phase === 'downloading' &&
    event.completedBytes !== undefined &&
    process.stderr.isTTY
  ) {
    const totalBytes = event.totalBytes ?? event.completedBytes;
    const ratio =
      totalBytes > 0 ? Math.min(event.completedBytes / totalBytes, 1) : 0;
    const width = 24;
    const filled = Math.round(ratio * width);
    const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
    const percent = Math.round(ratio * 100);
    const label = event.asset ?? 'asset';
    process.stderr.write(
      `\r[${bar}] ${String(percent).padStart(3, ' ')}% ${label} ${formatBytes(
        event.completedBytes,
      )}/${formatBytes(totalBytes)}`,
    );
    progressLineActive = true;
    return;
  }

  clearProgressLine();
  process.stderr.write(`${event.message}\n`);
}

async function ensureSearchService() {
  await searchService.initialize();
}

function getToolInspectRecord(operation: ReferenceOperationDefinition) {
  return {
    id: operation.id,
    cliName: operation.cliName,
    handlerId: operation.handlerId,
    mcpName: operation.mcpName,
    description: operation.description,
    inputSchema: operation.inputSchema,
    requiresSearchService: operation.requiresSearchService,
  };
}

async function executeMcpOperation(
  operation: ReferenceOperationDefinition,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (operation.requiresSearchService) {
    await ensureSearchService();
  }

  switch (operation.id) {
    case 'search':
      return (await searchCode(searchService, args as any)) as CallToolResult;
    case 'relationship':
      return (await findByRelationship(
        searchService,
        args as any,
      )) as CallToolResult;
    case 'api':
      return (await getApiReference(
        searchService,
        args as any,
      )) as CallToolResult;
    case 'file':
      return (await getFileContent(fileService, args as any)) as CallToolResult;
    case 'components':
      return (await listEcsComponents(
        searchService,
        args as any,
      )) as CallToolResult;
    case 'systems':
      return (await listEcsSystems(
        searchService,
        args as any,
      )) as CallToolResult;
    case 'dependents':
      return (await findDependents(
        searchService,
        args as any,
      )) as CallToolResult;
    case 'examples':
      return (await findUsageExamples(
        searchService,
        args as any,
      )) as CallToolResult;
    default: {
      const exhaustiveCheck: never = operation.id;
      return {
        content: [{ type: 'text', text: `Unknown tool: ${exhaustiveCheck}` }],
        isError: true,
      } as CallToolResult;
    }
  }
}

function createServer() {
  const server = new Server(
    {
      name: 'iwsdk-reference',
      version: getReferencePackageVersion(),
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: REFERENCE_MCP_TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const operation = getReferenceOperationByMcpName(name);
    if (!operation) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      } as CallToolResult;
    }

    try {
      return await executeMcpOperation(
        operation,
        (args ?? {}) as Record<string, unknown>,
      );
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error executing tool ${name}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      } as CallToolResult;
    }
  });

  return server;
}

async function runStatusCommand() {
  writeEnvelope<ReferenceCacheStatus>({
    ok: true,
    data: await getReferenceCacheStatus(),
  });
}

async function runWarmupCommand() {
  try {
    const status = await warmupReferenceAssets({
      onEvent: renderWarmupEvent,
    });
    clearProgressLine();
    writeEnvelope<ReferenceCacheStatus>({
      ok: true,
      data: status,
    });
  } catch (error) {
    clearProgressLine();
    writeEnvelope<never>({
      ok: false,
      error: {
        code:
          error instanceof Error && 'code' in error
            ? String(error.code)
            : 'warmup_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exitCode = 1;
  }
}

async function runInspectCommand(options: CliOptions) {
  const toolName = typeof options.tool === 'string' ? options.tool : undefined;
  const operation =
    toolName == null
      ? null
      : (getReferenceOperationByCliName(toolName) ??
        getReferenceOperationByMcpName(toolName));

  if (toolName && !operation) {
    writeEnvelope<never>({
      ok: false,
      error: {
        code: 'unknown_reference_tool',
        message: `Unknown reference tool "${toolName}"`,
      },
    });
    process.exitCode = 1;
    return;
  }

  if (operation) {
    writeEnvelope({ ok: true, data: getToolInspectRecord(operation) });
    return;
  }

  writeEnvelope({
    ok: true,
    data: {
      operations: REFERENCE_OPERATIONS.map(getToolInspectRecord),
    },
  });
}

async function runCliOperation(options: CliOptions) {
  const cliOperation =
    typeof options.cliOperation === 'string' ? options.cliOperation : undefined;
  if (!cliOperation) {
    writeEnvelope<never>({
      ok: false,
      error: {
        code: 'missing_reference_operation',
        message: '--cli-operation is required',
      },
    });
    process.exitCode = 1;
    return;
  }

  const operation = getReferenceOperationByCliName(cliOperation);
  if (!operation) {
    writeEnvelope<never>({
      ok: false,
      error: {
        code: 'unknown_reference_operation',
        message: `Unknown reference operation "${cliOperation}"`,
      },
    });
    process.exitCode = 1;
    return;
  }

  try {
    if (operation.requiresSearchService) {
      await ensureSearchService();
    }

    const args =
      typeof options.inputJson === 'string'
        ? safeJsonParse<Record<string, unknown>>(
            options.inputJson,
            '--input-json',
          )
        : {};

    writeEnvelope({
      ok: true,
      data: {
        operation: operation.id,
        cliName: operation.cliName,
        mcpName: operation.mcpName,
        result: await executeReferenceOperation(
          operation,
          {
            searchService,
            fileService,
          },
          args,
        ),
      },
    });
  } catch (error) {
    writeEnvelope<never>({
      ok: false,
      error: {
        code: 'reference_query_failed',
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exitCode = 1;
  }
}

async function runServer() {
  console.error('Starting IWSDK Reference MCP Server...');
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error('IWSDK Reference MCP Server is ready');
}

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  if (parsed.options.statusJson) {
    await runStatusCommand();
    return;
  }

  if (parsed.options.warmup) {
    await runWarmupCommand();
    return;
  }

  if (parsed.options.inspectJson) {
    await runInspectCommand(parsed.options);
    return;
  }

  if (parsed.options.cliOperation) {
    await runCliOperation(parsed.options);
    return;
  }

  await runServer();
}

main().catch((error) => {
  clearProgressLine();
  console.error('Fatal error:', error);
  process.exit(1);
});
