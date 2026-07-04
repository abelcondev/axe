/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Fail every subprocess (npm view / git clone / npm pack) so indexing falls
// through to the local node_modules strategy — no network in tests.
const execCommand = vi.fn(async () => ({ stdout: '', stderr: '', code: 1 }));
vi.mock('../../utils/shell-utils.js', () => ({
  execCommand,
}));

const runRipgrep = vi.fn(async () => ({ stdout: '', truncated: false }));
vi.mock('../../utils/ripgrepUtils.js', () => ({
  runRipgrep,
}));

// Imported after the mocks are registered.
const {
  ReferenceService,
  buildSearchPattern,
  escapeRegExp,
  normalizeGitUrl,
} = await import('./referenceService.js');

async function writeJson(file: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj), 'utf8');
}

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('buildSearchPattern', () => {
  it('passes a single token through verbatim (regex allowed)', () => {
    expect(buildSearchPattern('useState')).toBe('useState');
    expect(buildSearchPattern('  foo.*bar  ')).toBe('foo.*bar');
  });

  it('escapes and OR-joins multiple tokens', () => {
    expect(buildSearchPattern('foo bar')).toBe('foo|bar');
    expect(buildSearchPattern('a.b c')).toBe('a\\.b|c');
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c');
  });
});

describe('normalizeGitUrl', () => {
  it('strips git+ and .git, converts protocols', () => {
    expect(normalizeGitUrl('git+https://github.com/x/y.git')).toBe(
      'https://github.com/x/y',
    );
    expect(normalizeGitUrl('git://github.com/x/y.git')).toBe(
      'https://github.com/x/y',
    );
    expect(normalizeGitUrl('git@github.com:x/y.git')).toBe(
      'https://github.com/x/y',
    );
  });

  it('returns empty for empty input', () => {
    expect(normalizeGitUrl('')).toBe('');
  });
});

describe('ReferenceService', () => {
  let projectDir: string;
  let homeDir: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-ref-proj-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-ref-home-'));
    prevHome = process.env['AXE_HOME'];
    process.env['AXE_HOME'] = homeDir;
    execCommand.mockClear();
    runRipgrep.mockClear();
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env['AXE_HOME'];
    } else {
      process.env['AXE_HOME'] = prevHome;
    }
    await fs.rm(projectDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  async function scaffoldProject(): Promise<void> {
    await writeJson(path.join(projectDir, 'package.json'), {
      name: 'app',
      dependencies: { foo: '^1.2.3' },
      devDependencies: { vitest: '^1.0.0' },
    });
    // Local install used by the fallback indexing strategy.
    await writeJson(
      path.join(projectDir, 'node_modules', 'foo', 'package.json'),
      { name: 'foo', version: '1.2.3' },
    );
    await writeFile(
      path.join(projectDir, 'node_modules', 'foo', 'index.js'),
      'export function createFoo() { return 42; }\n',
    );
  }

  it('resolves active production dependencies', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    const active = svc.getActivePackages();
    expect(active.map((p) => p.name)).toEqual(['foo']);
    expect(active[0].version).toBe('1.2.3');
  });

  it('rescan picks up dependencies installed after initialize', async () => {
    // Initialize BEFORE the project exists (mid-session scaffold scenario).
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    expect(svc.getActivePackages()).toEqual([]);

    await scaffoldProject();
    await svc.rescan();
    expect(svc.getActivePackages().map((p) => p.name)).toEqual(['foo']);
  });

  it('search rescans instead of reporting not-a-dependency on a stale scan', async () => {
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    expect(svc.getActivePackages()).toEqual([]);

    // Project scaffolded + deps installed mid-session (new-app workflow).
    await scaffoldProject();

    const outcome = await svc.search('foo', 'createFoo');
    expect(outcome.reason).not.toBe('not-a-dependency');
    expect(svc.getActivePackages().map((p) => p.name)).toEqual(['foo']);
  });

  it('falls back to node_modules when the git clone exceeds the size cap', async () => {
    await scaffoldProject();
    (execCommand as Mock).mockImplementation(
      async (cmd: string, args: string[] = []) => {
        if (cmd === 'npm' && args[0] === 'view') {
          return {
            stdout: 'git+https://github.com/acme/foo.git\n',
            stderr: '',
            code: 0,
          };
        }
        if (cmd === 'git' && args[0] === 'clone') {
          // "Clone" an oversized monorepo into the destination dir.
          const dest = args[args.length - 1];
          await fs.mkdir(dest, { recursive: true });
          const fh = await fs.open(path.join(dest, 'big.bin'), 'w');
          await fh.truncate(151 * 1024 * 1024);
          await fh.close();
          return { stdout: '', stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 1 };
      },
    );

    try {
      const svc = new ReferenceService();
      await svc.initialize(projectDir);
      const entry = await svc.ensureIndexed('foo');
      // The oversized git clone is discarded; the local install (exact
      // published files of the resolved version) is indexed instead.
      expect(entry?.status).toBe('indexed');
      expect(entry?.source).toBe('local');
    } finally {
      // Restore the default all-fail implementation for subsequent tests.
      (execCommand as Mock).mockImplementation(async () => ({
        stdout: '',
        stderr: '',
        code: 1,
      }));
    }
  });

  it('indexes from local node_modules and persists the manifest', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);

    const entry = await svc.ensureIndexed('foo');
    expect(entry?.status).toBe('indexed');
    expect(entry?.source).toBe('local');
    expect(entry?.fileCount).toBeGreaterThan(0);

    // Manifest written under ~/.axe/references (AXE_HOME).
    const manifestPath = path.join(homeDir, 'references', 'manifest.json');
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    expect(raw.references['foo@1.2.3'].status).toBe('indexed');

    // A fresh service instance loads the persisted manifest.
    const svc2 = new ReferenceService();
    await svc2.initialize(projectDir);
    expect(svc2.getManifest()['foo@1.2.3'].status).toBe('indexed');
  });

  it('de-duplicates concurrent ensureIndexed calls', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);

    const [a, b] = await Promise.all([
      svc.ensureIndexed('foo'),
      svc.ensureIndexed('foo'),
    ]);
    expect(a?.status).toBe('indexed');
    expect(b).toBe(a);
    // Only one indexing pass ran: a single `npm view` (git strategy probe).
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it('persists an error entry when no source can be obtained', async () => {
    await writeJson(path.join(projectDir, 'package.json'), {
      name: 'app',
      dependencies: { ghost: '^9.9.9' },
    });
    const svc = new ReferenceService();
    await svc.initialize(projectDir);

    const entry = await svc.ensureIndexed('ghost');
    expect(entry?.status).toBe('error');

    // A subsequent call does NOT retry (error is sticky).
    execCommand.mockClear();
    const again = await svc.ensureIndexed('ghost');
    expect(again?.status).toBe('error');
    expect(execCommand).not.toHaveBeenCalled();
  });

  it('returns not-a-dependency for unknown packages', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    const outcome = await svc.search('nope', 'anything');
    expect(outcome.reason).toBe('not-a-dependency');
    expect(await svc.ensureIndexed('nope')).toBeNull();
  });

  it('searches indexed source via ripgrep', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    await svc.ensureIndexed('foo');

    runRipgrep.mockResolvedValueOnce({
      stdout: JSON.stringify({
        type: 'match',
        data: {
          path: { text: path.join(homeDir, 'references', 'foo@1.2.3', 'index.js') },
          line_number: 1,
          lines: { text: 'export function createFoo() { return 42; }\n' },
        },
      }),
      truncated: false,
    });

    const outcome = await svc.search('foo', 'createFoo');
    expect(outcome.reason).toBeUndefined();
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].file).toBe('index.js');
    expect(outcome.results[0].line).toBe(1);
  });

  it('clears cached references', async () => {
    await scaffoldProject();
    const svc = new ReferenceService();
    await svc.initialize(projectDir);
    await svc.ensureIndexed('foo');
    expect(svc.getManifest()['foo@1.2.3']).toBeDefined();

    const removed = await svc.clear('foo');
    expect(removed).toBe(1);
    expect(svc.getManifest()['foo@1.2.3']).toBeUndefined();
  });
});
