/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import {
  REFERENCE_MCP_TOOLS,
  REFERENCE_OPERATIONS,
  getReferenceOperationByCliName,
  getReferenceOperationByMcpName,
} from '../src/contract.js';

describe('reference contract', () => {
  it('keeps MCP tool discovery derived from the shared operation contract', () => {
    expect(REFERENCE_MCP_TOOLS).toEqual(
      REFERENCE_OPERATIONS.map(({ mcpName, description, inputSchema }) => ({
        name: mcpName,
        description,
        inputSchema,
      })),
    );
  });

  it('provides stable CLI and MCP lookups for every operation', () => {
    const cliNames = new Set<string>();
    const mcpNames = new Set<string>();

    for (const operation of REFERENCE_OPERATIONS) {
      expect(getReferenceOperationByCliName(operation.cliName)).toEqual(
        operation,
      );
      expect(getReferenceOperationByMcpName(operation.mcpName)).toEqual(
        operation,
      );
      expect(cliNames.has(operation.cliName)).toBe(false);
      expect(mcpNames.has(operation.mcpName)).toBe(false);
      cliNames.add(operation.cliName);
      mcpNames.add(operation.mcpName);
    }
  });
});
