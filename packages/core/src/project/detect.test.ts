/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectMonorepo, getActiveWorkspace } from './detect.js';

async function writeJson(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj), 'utf8');
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('detectMonorepo', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-mono-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns not-a-monorepo for a plain package', async () => {
    await writeJson(path.join(root, 'package.json'), { name: 'solo' });
    const info = await detectMonorepo(root);
    expect(info.isMonorepo).toBe(false);
    expect(info.workspaceDirs).toEqual([]);
  });

  it('expands npm/bun workspaces (array form) with a glob', async () => {
    await writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: ['packages/*'],
    });
    await writeJson(path.join(root, 'packages', 'a', 'package.json'), {
      name: 'a',
    });
    await writeJson(path.join(root, 'packages', 'b', 'package.json'), {
      name: 'b',
    });
    // A directory without package.json must not be picked up.
    await fs.mkdir(path.join(root, 'packages', 'not-a-pkg'), {
      recursive: true,
    });

    const info = await detectMonorepo(root);
    expect(info.isMonorepo).toBe(true);
    expect(info.workspaceDirs.map((d) => path.basename(d)).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('supports the yarn object form (workspaces.packages)', async () => {
    await writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: { packages: ['apps/*'] },
    });
    await writeJson(path.join(root, 'apps', 'web', 'package.json'), {
      name: 'web',
    });
    const info = await detectMonorepo(root);
    expect(info.workspaceDirs.map((d) => path.basename(d))).toEqual(['web']);
  });

  it('reads pnpm-workspace.yaml and takes precedence over package.json', async () => {
    await writeJson(path.join(root, 'package.json'), {
      name: 'mono',
      workspaces: ['should-be-ignored/*'],
    });
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - "libs/*"\n',
    );
    await writeJson(path.join(root, 'libs', 'core', 'package.json'), {
      name: 'core',
    });
    const info = await detectMonorepo(root);
    expect(info.workspaceDirs.map((d) => path.basename(d))).toEqual(['core']);
  });

  it('honors negation patterns', async () => {
    await writeFile(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - "packages/*"\n  - "!packages/private"\n',
    );
    await writeJson(path.join(root, 'packages', 'keep', 'package.json'), {
      name: 'keep',
    });
    await writeJson(path.join(root, 'packages', 'private', 'package.json'), {
      name: 'private',
    });
    const info = await detectMonorepo(root);
    expect(info.workspaceDirs.map((d) => path.basename(d))).toEqual(['keep']);
  });
});

describe('getActiveWorkspace', () => {
  it('returns the deepest workspace dir containing cwd', () => {
    const info = {
      isMonorepo: true,
      root: '/repo',
      workspaceDirs: ['/repo/packages/a', '/repo/packages/b'],
    };
    expect(getActiveWorkspace(info, '/repo/packages/a/src/x')).toBe(
      '/repo/packages/a',
    );
  });

  it('returns null when cwd is outside every workspace', () => {
    const info = {
      isMonorepo: true,
      root: '/repo',
      workspaceDirs: ['/repo/packages/a'],
    };
    expect(getActiveWorkspace(info, '/repo/scripts')).toBeNull();
  });
});
