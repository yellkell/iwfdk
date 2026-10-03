#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import semver from 'semver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(p) {
  try {
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function gatherPnpmPackages(root) {
  const out = [];
  const pnpmRoot = path.join(root, 'node_modules', '.pnpm');
  if (!(await pathExists(pnpmRoot))) return out;
  const entries = await fs.readdir(pnpmRoot, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(pnpmRoot, ent.name);
    // Typical structure: .pnpm/<name>@<ver>.../node_modules/<name>/package.json
    // Walk shallowly to find any package.json files
    try {
      const maybeNm = path.join(dir, 'node_modules');
      const nmExists = await pathExists(maybeNm);
      if (!nmExists) continue;
      const nmEntries = await fs.readdir(maybeNm, { withFileTypes: true });
      for (const e2 of nmEntries) {
        if (!e2.isDirectory()) continue;
        if (e2.name.startsWith('@')) {
          const scopeDir = path.join(maybeNm, e2.name);
          const scopedEntries = await fs.readdir(scopeDir, {
            withFileTypes: true,
          });
          for (const scoped of scopedEntries) {
            if (!scoped.isDirectory()) continue;
            const pj = path.join(scopeDir, scoped.name, 'package.json');
            if (await pathExists(pj)) out.push(pj);
          }
        } else {
          const pj = path.join(maybeNm, e2.name, 'package.json');
          if (await pathExists(pj)) out.push(pj);
        }
      }
    } catch {}
  }
  return out;
}

async function gatherWorkspacePackages(root) {
  const out = [];
  const packagesDir = path.join(root, 'packages');
  if (!(await pathExists(packagesDir))) return out;
  // Shallow scan packages/*/package.json (and one more level for subpackages)
  const first = await fs.readdir(packagesDir, { withFileTypes: true });
  for (const ent of first) {
    const p = path.join(packagesDir, ent.name);
    if (ent.isDirectory()) {
      const pj = path.join(p, 'package.json');
      if (await pathExists(pj)) out.push(pj);
      // one more nested level
      try {
        const nested = await fs.readdir(p, { withFileTypes: true });
        for (const sub of nested) {
          if (!sub.isDirectory()) continue;
          const pj2 = path.join(p, sub.name, 'package.json');
          if (await pathExists(pj2)) out.push(pj2);
        }
      } catch {}
    }
  }
  return out;
}

function addToMap(map, key, val) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(val);
}

function summarize(rangesMap) {
  const rows = [];
  for (const [range, set] of rangesMap.entries()) {
    let min = null;
    try {
      const v = semver.minVersion(range);
      min = v ? v.version : null;
    } catch {}
    rows.push({ range, count: set.size, min });
  }
  rows.sort((a, b) => {
    // Sort by minimal version desc (stricter first), then by count desc
    const av = a.min ? semver.coerce(a.min) : null;
    const bv = b.min ? semver.coerce(b.min) : null;
    if (av && bv) {
      const cmp = semver.rcompare(av, bv);
      if (cmp !== 0) return cmp;
    } else if (av && !bv) {
      return -1;
    } else if (!av && bv) {
      return 1;
    }
    return b.count - a.count;
  });
  return rows;
}

function rangeFromComparators(comparators) {
  let exact = null;
  let lower = null;
  let upper = null;
  const other = [];

  for (const comparator of comparators) {
    if (!comparator.value) continue;
    const parsed = comparator.value.match(/^(<=|>=|<|>|=)?\s*(.+)$/);
    const op = parsed?.[1] || '=';
    const version = comparator.semver;
    if (!version || version.version === 'ANY') {
      continue;
    }

    if (op === '=') {
      exact = comparator;
    } else if (op === '>' || op === '>=') {
      if (
        !lower ||
        semver.gt(version, lower.semver) ||
        (semver.eq(version, lower.semver) &&
          op === '>' &&
          lower.operator === '>=')
      ) {
        lower = comparator;
      }
    } else if (op === '<' || op === '<=') {
      if (
        !upper ||
        semver.lt(version, upper.semver) ||
        (semver.eq(version, upper.semver) &&
          op === '<' &&
          upper.operator === '<=')
      ) {
        upper = comparator;
      }
    } else {
      other.push(comparator.value);
    }
  }

  if (exact) {
    const exactVersion = exact.semver.version;
    const rawRange =
      comparators
        .map((comparator) => comparator.value)
        .filter(Boolean)
        .join(' ') || '*';
    return semver.satisfies(exactVersion, rawRange, {
      includePrerelease: true,
    })
      ? exactVersion
      : `${exactVersion} <0.0.0-0`;
  }

  const range = [lower?.value, upper?.value, ...other]
    .filter(Boolean)
    .join(' ');
  return range || '*';
}

function isSatisfiableRange(range) {
  try {
    const min = semver.minVersion(range);
    return min
      ? semver.satisfies(min, range, { includePrerelease: true })
      : false;
  } catch {
    return false;
  }
}

function isSubsetOf(a, b) {
  try {
    return semver.subset(a, b, { includePrerelease: true });
  } catch {
    return false;
  }
}

function sortRangesAscending(a, b) {
  const av = semver.minVersion(a);
  const bv = semver.minVersion(b);
  if (av && bv) {
    const cmp = semver.compare(av, bv);
    if (cmp !== 0) return cmp;
  } else if (av && !bv) {
    return -1;
  } else if (!av && bv) {
    return 1;
  }
  return a.localeCompare(b);
}

function pruneRedundantRanges(ranges) {
  const unique = [...new Set(ranges)].sort(sortRangesAscending);
  return unique.filter(
    (range, index) =>
      !unique.some(
        (other, otherIndex) => index !== otherIndex && isSubsetOf(range, other),
      ),
  );
}

function intersectRangeParts(left, right) {
  const out = [];
  const leftRange = new semver.Range(left);
  const rightRange = new semver.Range(right);
  for (const leftSet of leftRange.set) {
    for (const rightSet of rightRange.set) {
      const candidate = semver.validRange(
        rangeFromComparators([...leftSet, ...rightSet]),
      );
      if (candidate && isSatisfiableRange(candidate)) {
        out.push(candidate);
      }
    }
  }
  return pruneRedundantRanges(out);
}

function intersectRanges(ranges) {
  let compatible = ['*'];
  for (const range of ranges) {
    const next = [];
    for (const existing of compatible) {
      next.push(...intersectRangeParts(existing, range));
    }
    compatible = pruneRedundantRanges(next);
    if (compatible.length === 0) return null;
  }
  return compatible.join(' || ');
}

async function main() {
  const root = REPO_ROOT;
  const args = process.argv.slice(2);
  // Flags:
  //   --set-engines             => write engines.node to root + all workspace package.json files using the computed floor
  const setEnginesFlag = args.includes('--set-engines');
  const ignoreScopes = new Set(['@iwsdk/']); // always ignored; no flag to override
  const seen = new Set(); // name@version
  const byRange = new Map(); // range -> Set(name@version)
  const invalid = new Map(); // invalidRange -> Set(name@version)
  const unspecified = new Set();

  const rootsToScan = [path.join(root, 'package.json')];
  const workspacePkgs = await gatherWorkspacePackages(root);
  rootsToScan.push(...workspacePkgs);
  const pnpmPkgs = await gatherPnpmPackages(root);
  rootsToScan.push(...pnpmPkgs);

  for (const pjPath of rootsToScan) {
    const pkg = await readJsonSafe(pjPath);
    if (!pkg || !pkg.name || !pkg.version) continue;

    // Skip ignored scopes entirely (affects both calculation and reporting)
    let ignored = false;
    if (typeof pkg.name === 'string' && pkg.name.startsWith('@')) {
      for (const sc of ignoreScopes) {
        if (pkg.name.startsWith(sc)) {
          ignored = true;
          break;
        }
      }
    }
    if (ignored) continue;

    const key = `${pkg.name}@${pkg.version}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const range = pkg.engines && pkg.engines.node;
    if (!range) {
      unspecified.add(key);
      continue;
    }
    try {
      // Validate range
      // semver.validRange returns null if invalid
      const vr = semver.validRange(range);
      if (!vr) {
        addToMap(invalid, String(range), key);
        continue;
      }
      addToMap(byRange, vr, key);
    } catch {
      addToMap(invalid, String(range), key);
    }
  }

  // Compute conservative floor
  let floor = null;
  for (const range of byRange.keys()) {
    try {
      const mv = semver.minVersion(range);
      if (!mv) continue;
      if (!floor || semver.gt(mv, floor)) floor = mv;
    } catch {}
  }

  console.log('Engine audit (node)');
  console.log('  Packages scanned:', seen.size);
  console.log(
    '  With engines.node:',
    [...byRange.values()].reduce((a, s) => a + s.size, 0),
  );
  console.log('  Without engines.node:', unspecified.size);
  console.log(
    '  With invalid engines.node:',
    [...invalid.values()].reduce((a, s) => a + s.size, 0),
  );
  if (floor) {
    console.log(
      '\nConservative minimum Node version required across deps: >=',
      floor.version,
    );
    // Find which packages/ranges set this floor
    const providers = [];
    for (const [range, set] of byRange.entries()) {
      try {
        const mv = semver.minVersion(range);
        if (mv && semver.eq(mv, floor)) {
          providers.push({ range, pkgs: Array.from(set).sort() });
        }
      } catch {}
    }
    if (providers.length) {
      console.log('\nPackages requiring this floor:');
      for (const p of providers) {
        const list = p.pkgs;
        const head = list.slice(0, 10).join(', ');
        const more = list.length > 10 ? ` …(+${list.length - 10} more)` : '';
        console.log(
          `  range ${p.range} -> ${list.length} pkg(s): ${head}${more}`,
        );
      }
    }
  } else {
    console.log(
      '\nNo valid engines.node constraints found; cannot compute a floor.',
    );
  }

  const rows = summarize(byRange);
  if (rows.length) {
    console.log('\nTop engine ranges (stricter first):');
    for (const r of rows.slice(0, 20)) {
      console.log(
        `  ${r.range.padEnd(24)} | min ${r.min || '-'} | ${r.count} packages`,
      );
    }
  }

  const compatibleRange = intersectRanges(byRange.keys());
  if (compatibleRange) {
    console.log('\nCompatible Node range across deps:', compatibleRange);
    const rootPkg = await readJsonSafe(path.join(root, 'package.json'));
    const declaredRootRange = rootPkg?.engines?.node;
    if (
      declaredRootRange &&
      semver.validRange(declaredRootRange) &&
      !isSubsetOf(declaredRootRange, compatibleRange)
    ) {
      console.log(
        '\nCurrent root engines.node is broader than the installed dependency constraints:',
      );
      console.log(`  declared:   ${declaredRootRange}`);
      console.log(`  compatible: ${compatibleRange}`);
    }
  } else if (byRange.size) {
    console.log(
      '\nNo compatible Node range satisfies all dependency engines.node constraints.',
    );
  }

  if (invalid.size) {
    console.log('\nInvalid engine ranges:');
    for (const [rng, set] of invalid.entries()) {
      console.log(
        `  ${rng}: ${[...set].slice(0, 5).join(', ')}${set.size > 5 ? '…' : ''}`,
      );
    }
  }

  // Write engines.node to workspace packages + root if requested
  if (setEnginesFlag) {
    if (!compatibleRange) {
      console.log('\nCannot set engines.node: no compatible range from audit.');
      return;
    }
    const setEnginesValue = compatibleRange;
    console.log(
      `\nApplying compatible range to engines.node: ${setEnginesValue}`,
    );
    const targets = [path.join(root, 'package.json'), ...workspacePkgs];
    let changed = 0;
    for (const pj of targets) {
      const pkg = await readJsonSafe(pj);
      if (!pkg) continue;
      pkg.engines = pkg.engines || {};
      if (pkg.engines.node !== setEnginesValue) {
        pkg.engines.node = setEnginesValue;
        await fs.writeFile(pj, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        changed++;
      }
    }
    console.log(
      `\nUpdated engines.node to ${setEnginesValue} in ${changed} package.json file(s).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
