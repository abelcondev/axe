/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as yamlParser from '../utils/yaml-parser.js';
import { createDebugLogger } from '../utils/debugLogger.js';
import { findProjectRoot } from '../utils/projectRoot.js';

// Re-exported so reference consumers have a single project entry point.
export { findProjectRoot };

const debugLogger = createDebugLogger('ProjectDetect');

export interface MonorepoInfo {
  /** True when the project declares workspaces (npm/yarn/bun or pnpm). */
  isMonorepo: boolean;
  /** Absolute path of the repo root that declares the workspaces. */
  root: string;
  /** Absolute paths of every workspace package dir (each holds a package.json). */
  workspaceDirs: string[];
}

async function readJson(
  file: string,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fsp.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Extracts workspace glob patterns from a root `package.json`. Supports both
 * the array form (`"workspaces": [...]`) and the object form
 * (`"workspaces": { "packages": [...] }`) used by yarn.
 */
function workspacePatternsFromPackageJson(
  pkgJson: Record<string, unknown>,
): string[] {
  const ws = pkgJson['workspaces'];
  if (Array.isArray(ws)) {
    return ws.filter((p): p is string => typeof p === 'string');
  }
  if (ws && typeof ws === 'object') {
    const pkgs = (ws as Record<string, unknown>)['packages'];
    if (Array.isArray(pkgs)) {
      return pkgs.filter((p): p is string => typeof p === 'string');
    }
  }
  return [];
}

/**
 * Expands a single workspace glob pattern (relative to `root`) into the set of
 * matching directories that contain a `package.json`. Supports literal paths,
 * a trailing `*` segment (`packages/*`), and `**` (recurse, bounded).
 * Negation patterns (`!`) are ignored here and applied by the caller.
 */
async function expandPattern(root: string, pattern: string): Promise<string[]> {
  const clean = pattern.replace(/\/+$/, '');
  const segments = clean.split('/');

  // Fast path: no wildcards — a literal package directory.
  if (!clean.includes('*')) {
    const dir = path.resolve(root, clean);
    return (await hasPackageJson(dir)) ? [dir] : [];
  }

  const results: string[] = [];
  // Walk the concrete prefix, then branch on the first wildcard segment.
  const walk = async (
    baseDir: string,
    remaining: string[],
    depth: number,
  ): Promise<void> => {
    if (depth > 32) {
      return;
    }
    if (remaining.length === 0) {
      if (await hasPackageJson(baseDir)) {
        results.push(baseDir);
      }
      return;
    }
    const [head, ...rest] = remaining;
    if (head === '**') {
      // Match zero-or-more directory levels.
      await walk(baseDir, rest, depth + 1);
      for (const child of await subDirs(baseDir)) {
        await walk(child, remaining, depth + 1);
      }
      return;
    }
    if (head === '*') {
      for (const child of await subDirs(baseDir)) {
        await walk(child, rest, depth + 1);
      }
      return;
    }
    await walk(path.join(baseDir, head), rest, depth + 1);
  };

  await walk(root, segments, 0);
  return results;
}

async function hasPackageJson(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(path.join(dir, 'package.json'))).isFile();
  } catch {
    return false;
  }
}

async function subDirs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git',
    )
    .map((e) => path.join(dir, e.name));
}

async function expandPatterns(
  root: string,
  patterns: string[],
): Promise<string[]> {
  const positive = patterns.filter((p) => !p.startsWith('!'));
  const negative = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1).replace(/\/+$/, ''));

  const dirs = new Set<string>();
  for (const pattern of positive) {
    for (const dir of await expandPattern(root, pattern)) {
      dirs.add(dir);
    }
  }
  // Drop directories excluded by a negation pattern.
  const excluded = new Set<string>();
  for (const neg of negative) {
    for (const dir of await expandPattern(root, neg)) {
      excluded.add(dir);
    }
  }
  return [...dirs].filter((d) => !excluded.has(d)).sort();
}

/**
 * Detects whether `root` is the root of a monorepo and, if so, resolves every
 * workspace package directory. Supports npm/yarn/bun workspaces (declared in
 * `package.json`) and pnpm workspaces (`pnpm-workspace.yaml`).
 */
export async function detectMonorepo(root: string): Promise<MonorepoInfo> {
  const empty: MonorepoInfo = { isMonorepo: false, root, workspaceDirs: [] };
  let patterns: string[] = [];

  // pnpm-workspace.yaml takes precedence when present.
  const pnpmFile = path.join(root, 'pnpm-workspace.yaml');
  try {
    const raw = await fsp.readFile(pnpmFile, 'utf8');
    const parsed = yamlParser.parse(raw);
    const pkgs = parsed['packages'];
    if (Array.isArray(pkgs)) {
      patterns = pkgs.filter((p): p is string => typeof p === 'string');
    }
  } catch {
    // No pnpm workspace file; fall back to package.json.
  }

  if (patterns.length === 0) {
    const pkgJson = await readJson(path.join(root, 'package.json'));
    if (pkgJson) {
      patterns = workspacePatternsFromPackageJson(pkgJson);
    }
  }

  if (patterns.length === 0) {
    return empty;
  }

  const workspaceDirs = await expandPatterns(root, patterns);
  if (workspaceDirs.length === 0) {
    return empty;
  }

  debugLogger.debug(
    `Detected monorepo at ${root} with ${workspaceDirs.length} workspace(s)`,
  );
  return { isMonorepo: true, root, workspaceDirs };
}

/**
 * Given the monorepo layout and the current working directory, returns the
 * workspace package directory that owns `cwd` (the deepest workspace dir that
 * is an ancestor of `cwd`), or `null` when `cwd` is not inside a workspace.
 */
export function getActiveWorkspace(
  info: MonorepoInfo,
  cwd: string,
): string | null {
  const resolvedCwd = path.resolve(cwd);
  let best: string | null = null;
  for (const dir of info.workspaceDirs) {
    const rel = path.relative(dir, resolvedCwd);
    const isInside =
      rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    if (isInside && (best === null || dir.length > best.length)) {
      best = dir;
    }
  }
  return best;
}

export { isDir };
