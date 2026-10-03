/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import json from '@rollup/plugin-json';

const external = [
  'buffer',
  'child_process',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'http',
  'https',
  'module',
  'net',
  'os',
  'path',
  'process',
  'stream',
  'tar',
  'tls',
  'url',
  'util',
  'zlib',
  // Keep @huggingface/transformers external — it has Node.js-specific file
  // loading code paths that break when bundled by Rollup.
  '@huggingface/transformers',
];

const plugins = [
  typescript({
    tsconfig: './tsconfig.json',
    declaration: false,
    declarationMap: false,
    sourceMap: true,
  }),
  resolve({ preferBuiltins: true }),
  json(),
  commonjs(),
];

export default [
  {
    input: 'src/index.ts',
    external,
    plugins,
    output: {
      file: 'dist/index.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
    },
  },
  {
    input: 'src/cli.ts',
    external,
    plugins,
    output: {
      file: 'dist/cli.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
      banner: '#!/usr/bin/env node',
    },
  },
  {
    input: 'src/contract.ts',
    external,
    plugins,
    output: {
      file: 'dist/contract.js',
      format: 'es',
      sourcemap: true,
      inlineDynamicImports: true,
    },
  },
];
