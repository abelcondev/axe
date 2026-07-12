/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDebugLogger } from '../../utils/debugLogger.js';
import { execCommand } from '../../utils/shell-utils.js';
import { runRipgrep } from '../../utils/ripgrepUtils.js';
import { Storage } from '../../config/storage.js';
import { ToolNames } from '../../tools/tool-names.js';
import {
  detectMonorepo,
  findProjectRoot,
  getActiveWorkspace,
} from '../../project/detect.js';
import { parseDependencies } from '../../project/dependencies.js';
import type {
  ActivePackage,
  IReferenceService,
  ReferenceEntry,
  ReferenceManifest,
  ReferenceSearchOutcome,
  ReferenceSearchResult,
  ReferenceSource,
} from './types.js';

const debugLogger = createDebugLogger('ReferenceService');

/** Hard cap on the on-disk size of a single indexed package. */
const MAX_INDEX_BYTES = 150 * 1024 * 1024;
/** How many packages to fetch concurrently during background warmup. */
const BACKGROUND_INDEX_CONCURRENCY = 3;
/** Cap on ranked result blocks returned to the model. */
const MAX_SEARCH_RESULTS = 24;
/** Cap on a single snippet line (compiled dist lines can be enormous). */
const MAX_LINE_CHARS = 300;
/** Multi-word query tokens shorter than this match everywhere; drop them. */
const MIN_TOKEN_LENGTH = 3;
const MANIFEST_VERSION = 1;
const GIT_TIMEOUT_MS = 60_000;
const NPM_TIMEOUT_MS = 60_000;

/** Escapes a string for safe use as a literal inside a regular expression. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps an escaped token in `\b` word boundaries where the token edge is a
 * word character (Rust's regex crate has no lookarounds, and `\b` next to a
 * non-word edge like `$state` would never match).
 */
function wordBounded(token: string): string {
  const lead = /^\w/.test(token) ? '\\b' : '';
  const trail = /\w$/.test(token) ? '\\b' : '';
  return `${lead}${escapeRegExp(token)}${trail}`;
}

/**
 * Splits a multi-word query into the tokens actually worth matching: short
 * tokens (`i`, `of`) match nearly every line as substrings, so they are
 * dropped — unless that would drop everything.
 */
export function queryTokens(query: string): string[] {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return tokens;
  }
  const meaningful = tokens.filter((t) => t.length >= MIN_TOKEN_LENGTH);
  return meaningful.length > 0 ? meaningful : tokens;
}

/**
 * Builds the ripgrep pattern for a query. A single token is passed through
 * verbatim (so callers can use a regex or an exact identifier); multiple
 * tokens are escaped, word-bounded, and OR-joined.
 */
export function buildSearchPattern(query: string): string {
  const tokens = queryTokens(query);
  if (tokens.length <= 1 && tokens[0] === query.trim()) {
    return query.trim();
  }
  return tokens.map(wordBounded).join('|');
}

/** Filesystem-safe manifest key → directory name (scoped names contain `/`). */
function keyToDirName(key: string): string {
  return key.replace(/[/\\]/g, '+');
}

function refKey(name: string, version: string): string {
  return `${name}@${version}`;
}

/** Normalizes an npm `repository.url` to an https git URL git can clone. */
export function normalizeGitUrl(url: string): string {
  let u = url.trim();
  if (!u) {
    return '';
  }
  u = u.replace(/^git\+/, '');
  u = u.replace(/^git:\/\//, 'https://');
  const ssh = u.match(/^git@([^:]+):(.+)$/);
  if (ssh) {
    u = `https://${ssh[1]}/${ssh[2]}`;
  }
  u = u.replace(/\.git$/, '');
  return u;
}

async function rmrf(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Copies a source tree into `dest`, skipping `node_modules` and `.git`, and
 * dereferencing symlinks (pnpm stores linked packages under `.pnpm`).
 */
async function copyTree(src: string, dest: string): Promise<void> {
  await fsp.cp(src, dest, {
    recursive: true,
    dereference: true,
    filter: (from: string) => {
      const base = path.basename(from);
      return base !== 'node_modules' && base !== '.git';
    },
  });
}

/** Totals the byte size and file count of a directory tree. */
async function dirStats(
  dir: string,
): Promise<{ size: number; fileCount: number }> {
  let size = 0;
  let fileCount = 0;
  const walk = async (d: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        try {
          size += (await fsp.stat(full)).size;
          fileCount++;
        } catch {
          // Ignore unreadable files.
        }
      }
    }
  };
  await walk(dir);
  return { size, fileCount };
}

/**
 * Indexes the real source of a project's production dependencies into
 * `~/.axe/references/` so the agent can search the exact installed version
 * instead of guessing APIs. Git-first (best grounding), falling back to the
 * local `node_modules` copy, then `npm pack`.
 */
export class ReferenceService implements IReferenceService {
  private ready = false;
  private activePackages: ActivePackage[] = [];
  /** Transitive deps resolved from node_modules on demand (not in package.json). */
  private onDemandPackages: ActivePackage[] = [];
  private moduleResolveRoots: string[] = [];
  /** cwd of the last initialize() — lets rescan() re-read package.json. */
  private lastCwd: string | null = null;
  private manifest: ReferenceManifest = {
    version: MANIFEST_VERSION,
    references: {},
  };
  private readonly inFlight = new Map<string, Promise<ReferenceEntry>>();
  private warmupPromise: Promise<void> | null = null;

  static createStandalone(): ReferenceService {
    return new ReferenceService();
  }

  private get referencesDir(): string {
    return Storage.getGlobalReferencesDir();
  }

  private get manifestPath(): string {
    return path.join(this.referencesDir, 'manifest.json');
  }

  async initialize(cwd: string): Promise<void> {
    this.ready = true;
    this.lastCwd = cwd;
    this.activePackages = [];
    this.onDemandPackages = [];
    // Note: `inFlight` is deliberately NOT cleared — initialize() doubles as
    // rescan() and must not lose dedup tracking of indexing tasks already
    // running in the background.

    try {
      const projectRoot = (await findProjectRoot(cwd)) ?? path.resolve(cwd);

      const monorepo = await detectMonorepo(projectRoot);
      const activeWorkspace = monorepo.isMonorepo
        ? getActiveWorkspace(monorepo, cwd)
        : null;

      // Dedup while preserving order: active workspace first, then repo root.
      this.moduleResolveRoots = [
        ...new Set([activeWorkspace, projectRoot].filter(Boolean) as string[]),
      ];

      // Read production deps from the active workspace and the repo root, so
      // both workspace-local and hoisted root deps are covered.
      const depSources = [
        ...new Set([activeWorkspace, projectRoot].filter(Boolean) as string[]),
      ];
      const byInstallName = new Map<string, ActivePackage>();
      for (const dir of depSources) {
        const pkgJson = await readJson(path.join(dir, 'package.json'));
        if (!pkgJson) {
          continue;
        }
        for (const dep of parseDependencies(pkgJson)) {
          if (!byInstallName.has(dep.installName)) {
            byInstallName.set(dep.installName, {
              name: dep.name,
              installName: dep.installName,
              version: dep.version,
            });
          }
        }
      }
      this.activePackages = [...byInstallName.values()].sort((a, b) =>
        a.installName.localeCompare(b.installName),
      );

      await this.loadManifest();
      debugLogger.debug(
        `Reference service ready: ${this.activePackages.length} active package(s)`,
      );
    } catch (err) {
      debugLogger.warn(
        `ReferenceService initialize failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Re-reads the project's package.json(s) with the cwd from the last
   * initialize(). Dependencies installed mid-session (e.g. a project
   * scaffolded by the new-app workflow after startup) become visible without
   * restarting — the startup scan is otherwise frozen for the session.
   */
  async rescan(): Promise<void> {
    if (this.lastCwd) {
      await this.initialize(this.lastCwd);
    }
  }

  getActivePackages(): ActivePackage[] {
    return this.activePackages;
  }

  getManifest(): Record<string, ReferenceEntry> {
    return this.manifest.references;
  }

  async clear(packageName?: string): Promise<number> {
    const pkg = packageName ? this.resolveActive(packageName) : null;
    const keys = Object.keys(this.manifest.references).filter((key) => {
      if (!packageName) {
        return true;
      }
      const entry = this.manifest.references[key];
      // Match by resolved active package (name+version) or bare package name.
      return pkg
        ? key === refKey(pkg.name, pkg.version)
        : entry?.package === packageName;
    });

    for (const key of keys) {
      const entry = this.manifest.references[key];
      if (entry?.cachePath) {
        await rmrf(entry.cachePath);
      } else {
        await rmrf(path.join(this.referencesDir, keyToDirName(key)));
      }
      delete this.manifest.references[key];
    }

    if (keys.length > 0) {
      await this.persistManifest();
    }
    return keys.length;
  }

  /** Fire-and-forget background indexing of all not-yet-indexed packages. */
  warmup(): Promise<void> {
    if (this.warmupPromise) {
      return this.warmupPromise;
    }
    this.warmupPromise = this.indexActiveInBackground();
    return this.warmupPromise;
  }

  private async indexActiveInBackground(): Promise<void> {
    const queue = this.activePackages.filter((pkg) => {
      const entry = this.manifest.references[refKey(pkg.name, pkg.version)];
      // Skip anything already resolved (indexed) or known-bad (error).
      return !entry || entry.status === 'pending';
    });
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < queue.length) {
        const pkg = queue[cursor++];
        try {
          await this.ensureIndexed(pkg.installName);
        } catch (err) {
          debugLogger.warn(
            `Background index of ${pkg.name} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    };
    const workers = Array.from(
      { length: Math.min(BACKGROUND_INDEX_CONCURRENCY, queue.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  getSummary(): string {
    if (this.activePackages.length === 0) {
      return '';
    }
    const lines = this.activePackages.map((pkg) => {
      const entry = this.manifest.references[refKey(pkg.name, pkg.version)];
      let status: string;
      if (entry?.status === 'indexed') {
        status = `indexed (${entry.fileCount} files)`;
      } else if (entry?.status === 'error') {
        status = 'unavailable';
      } else {
        status = 'indexing…';
      }
      return `- ${pkg.name}@${pkg.version} — ${status}`;
    });

    return `# Dependency source references

These installed dependencies have their real source indexed under \`~/.axe/references\` (or are being indexed now). Use the '${ToolNames.REFERENCE}' tool to search a package's ACTUAL source for the exact installed version instead of relying on memory or guessing its API. Transitive dependencies not listed below (packages inside node_modules, e.g. the core package behind a framework adapter) can also be searched by exact name — they are indexed on demand.

${lines.join('\n')}`;
  }

  async ensureIndexed(
    packageName: string,
    options?: { force?: boolean },
  ): Promise<ReferenceEntry | null> {
    const pkg = await this.resolvePackage(packageName);
    if (!pkg) {
      return null;
    }
    const key = refKey(pkg.name, pkg.version);

    if (!options?.force) {
      const existing = this.manifest.references[key];
      if (existing && existing.status !== 'pending') {
        // `indexed` → reuse; `error` → don't retry automatically.
        if (existing.status === 'indexed' && existing.cachePath) {
          if (await pathExists(existing.cachePath)) {
            return existing;
          }
        } else if (existing.status === 'error') {
          return existing;
        }
      }
      const pending = this.inFlight.get(key);
      if (pending) {
        return pending;
      }
    }

    const task = this.indexPackage(pkg).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, task);
    return task;
  }

  async resolveInstalled(packageName: string): Promise<ActivePackage | null> {
    return this.resolvePackage(packageName);
  }

  private resolveActive(packageName: string): ActivePackage | null {
    const match = (p: ActivePackage) =>
      p.installName === packageName || p.name === packageName;
    return (
      this.activePackages.find(match) ??
      this.onDemandPackages.find(match) ??
      null
    );
  }

  /**
   * Resolves a package from the active set, falling back to a node_modules
   * lookup so transitive dependencies (e.g. `@instantdb/core` behind
   * `@instantdb/svelte`) can be indexed and searched on demand.
   */
  private async resolvePackage(
    packageName: string,
  ): Promise<ActivePackage | null> {
    const active = this.resolveActive(packageName);
    if (active) {
      return active;
    }
    const found = await this.resolveFromNodeModules(packageName);
    if (found) {
      this.onDemandPackages.push(found);
    }
    return found;
  }

  /**
   * Locates an installed package in node_modules: hoisted (npm/bun), nested
   * one level under a direct dependency, or in pnpm's `.pnpm` store.
   */
  private async resolveFromNodeModules(
    packageName: string,
  ): Promise<ActivePackage | null> {
    const candidates: string[] = [];
    for (const root of this.moduleResolveRoots) {
      candidates.push(path.join(root, 'node_modules', packageName));
      for (const dep of this.activePackages) {
        candidates.push(
          path.join(
            root,
            'node_modules',
            dep.installName,
            'node_modules',
            packageName,
          ),
        );
      }
      // pnpm store layout: node_modules/.pnpm/<name>@<ver>/node_modules/<name>
      const pnpmDir = path.join(root, 'node_modules', '.pnpm');
      const prefix = `${keyToDirName(packageName)}@`;
      try {
        for (const entry of await fsp.readdir(pnpmDir)) {
          if (entry.startsWith(prefix)) {
            candidates.push(
              path.join(pnpmDir, entry, 'node_modules', packageName),
            );
          }
        }
      } catch {
        // Not a pnpm project.
      }
    }
    for (const dir of candidates) {
      const pkgJson = await readJson(path.join(dir, 'package.json'));
      const version = pkgJson?.['version'];
      if (typeof version === 'string' && version) {
        const name =
          typeof pkgJson['name'] === 'string'
            ? (pkgJson['name'] as string)
            : packageName;
        return { name, installName: packageName, version, localPath: dir };
      }
    }
    return null;
  }

  private async indexPackage(pkg: ActivePackage): Promise<ReferenceEntry> {
    const key = refKey(pkg.name, pkg.version);
    const cachePath = path.join(this.referencesDir, keyToDirName(key));
    await rmrf(cachePath);
    await fsp.mkdir(this.referencesDir, { recursive: true });

    const now = new Date().toISOString();
    let source: ReferenceSource | null = null;
    let repo: string | undefined;

    try {
      // Strategy 1: git clone the upstream repo at the installed version.
      repo = await this.tryGit(pkg, cachePath);
      if (repo !== undefined) {
        source = 'git';
        // An oversized clone is usually a monorepo carrying far more than
        // this package (server, examples, sibling packages). Discard it and
        // fall through to the local install, which holds exactly the
        // published files of the resolved version.
        if ((await dirStats(cachePath)).size > MAX_INDEX_BYTES) {
          await rmrf(cachePath);
          source = null;
          repo = undefined;
        }
      }
      // Strategy 2: copy the local node_modules install.
      if (!source && (await this.tryLocal(pkg, cachePath))) {
        source = 'local';
      }
      // Strategy 3: npm pack the published tarball.
      if (!source && (await this.tryNpmPack(pkg, cachePath))) {
        source = 'npm';
      }

      if (!source) {
        return this.persistEntry(key, {
          package: pkg.name,
          version: pkg.version,
          source: 'npm',
          size: 0,
          fileCount: 0,
          status: 'error',
          error: 'Could not obtain source via git, node_modules, or npm pack.',
        });
      }

      const { size, fileCount } = await dirStats(cachePath);
      if (size > MAX_INDEX_BYTES) {
        await rmrf(cachePath);
        return this.persistEntry(key, {
          package: pkg.name,
          version: pkg.version,
          source,
          repo,
          size,
          fileCount,
          status: 'error',
          error: `Source exceeds ${Math.round(
            MAX_INDEX_BYTES / (1024 * 1024),
          )}MB cap (${Math.round(size / (1024 * 1024))}MB).`,
        });
      }

      return this.persistEntry(key, {
        package: pkg.name,
        version: pkg.version,
        source,
        repo,
        clonedAt: source === 'git' ? now : undefined,
        indexedAt: now,
        size,
        fileCount,
        status: 'indexed',
        cachePath,
      });
    } catch (err) {
      await rmrf(cachePath);
      return this.persistEntry(key, {
        package: pkg.name,
        version: pkg.version,
        source: source ?? 'npm',
        repo,
        size: 0,
        fileCount: 0,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Returns the repo URL on success, or `undefined` when git indexing fails. */
  private async tryGit(
    pkg: ActivePackage,
    cachePath: string,
  ): Promise<string | undefined> {
    let url = '';
    let subdir: string | undefined;
    try {
      const { stdout, code } = await execCommand(
        'npm',
        ['view', `${pkg.name}@${pkg.version}`, 'repository', '--json'],
        { preserveOutputOnError: true, timeout: NPM_TIMEOUT_MS },
      );
      if (code !== 0) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(stdout || 'null');
      if (typeof parsed === 'string') {
        url = normalizeGitUrl(parsed);
      } else if (parsed && typeof parsed === 'object') {
        const repo = parsed as { url?: unknown; directory?: unknown };
        url = normalizeGitUrl(typeof repo.url === 'string' ? repo.url : '');
        subdir =
          typeof repo.directory === 'string' && repo.directory.trim()
            ? repo.directory.trim()
            : undefined;
      }
    } catch {
      return undefined;
    }
    if (!url) {
      return undefined;
    }

    const tmp = path.join(
      os.tmpdir(),
      `axe-ref-${keyToDirName(refKey(pkg.name, pkg.version))}-${Date.now()}`,
    );
    const refs =
      pkg.version === 'latest'
        ? [undefined]
        : [`v${pkg.version}`, pkg.version, undefined];
    const gitOpts = { preserveOutputOnError: true, timeout: GIT_TIMEOUT_MS };

    try {
      for (const ref of refs) {
        await rmrf(tmp);
        // When the package lives in a monorepo subdirectory, sparse-checkout
        // just that directory (plus top-level docs) so the clone stays small
        // and the real TS source survives the size cap.
        const args = [
          'clone',
          '--depth',
          '1',
          '--single-branch',
          ...(ref ? ['--branch', ref] : []),
          ...(subdir ? ['--filter=blob:none', '--no-checkout'] : []),
          url,
          tmp,
        ];
        const { code } = await execCommand('git', args, gitOpts);
        if (code !== 0) {
          continue;
        }
        if (subdir) {
          await execCommand(
            'git',
            ['-C', tmp, 'sparse-checkout', 'set', '--cone', subdir, 'docs'],
            gitOpts,
          );
          const checkout = await execCommand(
            'git',
            ['-C', tmp, 'checkout'],
            gitOpts,
          );
          if (checkout.code !== 0) {
            continue;
          }
        }
        await copyTree(tmp, cachePath);
        return url;
      }
      return undefined;
    } finally {
      await rmrf(tmp);
    }
  }

  private async tryLocal(
    pkg: ActivePackage,
    cachePath: string,
  ): Promise<boolean> {
    const dirs = [
      ...(pkg.localPath ? [pkg.localPath] : []),
      ...this.moduleResolveRoots.map((root) =>
        path.join(root, 'node_modules', pkg.installName),
      ),
    ];
    for (const modDir of dirs) {
      if (await pathExists(path.join(modDir, 'package.json'))) {
        await copyTree(modDir, cachePath);
        return true;
      }
    }
    return false;
  }

  private async tryNpmPack(
    pkg: ActivePackage,
    cachePath: string,
  ): Promise<boolean> {
    const tmp = path.join(
      os.tmpdir(),
      `axe-pack-${keyToDirName(refKey(pkg.name, pkg.version))}-${Date.now()}`,
    );
    try {
      await fsp.mkdir(tmp, { recursive: true });
      const { stdout, code } = await execCommand(
        'npm',
        [
          'pack',
          `${pkg.name}@${pkg.version}`,
          '--pack-destination',
          tmp,
          '--json',
        ],
        { preserveOutputOnError: true, timeout: NPM_TIMEOUT_MS },
      );
      if (code !== 0) {
        return false;
      }
      let filename: string | undefined;
      try {
        const parsed = JSON.parse(stdout);
        filename = Array.isArray(parsed) ? parsed[0]?.filename : undefined;
      } catch {
        filename = undefined;
      }
      if (!filename) {
        return false;
      }
      const tarball = path.join(tmp, filename);
      const extract = await execCommand('tar', ['-xzf', tarball, '-C', tmp], {
        preserveOutputOnError: true,
        timeout: NPM_TIMEOUT_MS,
      });
      if (extract.code !== 0) {
        return false;
      }
      const packageDir = path.join(tmp, 'package');
      if (!(await pathExists(packageDir))) {
        return false;
      }
      await copyTree(packageDir, cachePath);
      return true;
    } catch {
      return false;
    } finally {
      await rmrf(tmp);
    }
  }

  async search(
    packageName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<ReferenceSearchOutcome> {
    let pkg = this.resolveActive(packageName);
    if (!pkg) {
      // The startup scan may be stale (dependency installed mid-session):
      // re-read package.json first, then fall back to a node_modules lookup
      // for transitive dependencies.
      await this.rescan();
      pkg = await this.resolvePackage(packageName);
    }
    if (!pkg) {
      return { results: [], reason: 'not-a-dependency' };
    }
    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [], reason: 'pending' };
    }

    const entry = await this.ensureIndexed(pkg.installName);
    if (!entry) {
      return { results: [], reason: 'not-a-dependency' };
    }
    if (entry.status === 'error') {
      return { results: [], entry, reason: 'errored', detail: entry.error };
    }
    if (entry.status !== 'indexed' || !entry.cachePath) {
      return { results: [], entry, reason: 'pending' };
    }

    const pattern = buildSearchPattern(trimmed);
    const { stdout } = await runRipgrep(
      [
        '--json',
        '-S',
        '--context',
        '2',
        '--max-count',
        '10',
        // Metadata and generated files bury real source in noise.
        '-g',
        '!package.json',
        '-g',
        '!*lock*',
        '-g',
        '!*.map',
        '-g',
        '!*.min.*',
        '-g',
        '!CHANGELOG*',
        '-g',
        '!LICENSE*',
        '-e',
        pattern,
        entry.cachePath,
      ],
      signal,
    );

    const lines = parseRipgrepLines(stdout, entry.cachePath);
    const results = rankSearchResults(
      lines,
      queryTokens(trimmed),
      MAX_SEARCH_RESULTS,
    );
    return { results, entry };
  }

  private async loadManifest(): Promise<void> {
    const parsed = await readJson(this.manifestPath);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed['references'] &&
      typeof parsed['references'] === 'object'
    ) {
      this.manifest = {
        version:
          typeof parsed['version'] === 'number'
            ? (parsed['version'] as number)
            : MANIFEST_VERSION,
        references: parsed['references'] as Record<string, ReferenceEntry>,
      };
    } else {
      this.manifest = { version: MANIFEST_VERSION, references: {} };
    }
  }

  private async persistEntry(
    key: string,
    entry: ReferenceEntry,
  ): Promise<ReferenceEntry> {
    this.manifest.references[key] = entry;
    await this.persistManifest();
    return entry;
  }

  private async persistManifest(): Promise<void> {
    try {
      await fsp.mkdir(this.referencesDir, { recursive: true });
      await fsp.writeFile(
        this.manifestPath,
        JSON.stringify(this.manifest, null, 2),
        'utf8',
      );
    } catch (err) {
      debugLogger.warn(
        `Failed to persist reference manifest: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/** One parsed line (match or surrounding context) from `rg --json` output. */
export interface RipgrepLine {
  file: string;
  line: number;
  text: string;
  isMatch: boolean;
}

/** Parses `rg --json` stdout (match + context events), relative to `root`. */
function parseRipgrepLines(stdout: string, root: string): RipgrepLine[] {
  const lines: RipgrepLine[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    let obj: {
      type?: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
      };
    };
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if ((obj.type !== 'match' && obj.type !== 'context') || !obj.data) {
      continue;
    }
    const absPath = obj.data.path?.text;
    const lineNumber = obj.data.line_number;
    const text = obj.data.lines?.text;
    if (!absPath || !lineNumber || text === undefined) {
      continue;
    }
    const clean = text.replace(/\n$/, '').trimEnd();
    lines.push({
      file: path.relative(root, absPath),
      line: lineNumber,
      text:
        clean.length > MAX_LINE_CHARS
          ? `${clean.slice(0, MAX_LINE_CHARS)}…`
          : clean,
      isMatch: obj.type === 'match',
    });
  }
  return lines;
}

/**
 * Scores a file for result ranking: hand-written types and source are what
 * the model needs to learn an API; compiled dist output and prose rank lower.
 */
function fileScore(file: string): number {
  const f = file.split(path.sep).join('/');
  const base = f.slice(f.lastIndexOf('/') + 1).toLowerCase();
  if (/\.d\.[cm]?ts$/.test(base)) {
    return 100;
  }
  if (/\.[cm]?tsx?$/.test(base) || /\.(svelte|vue)$/.test(base)) {
    return /(^|\/)src\//.test(f) ? 95 : 90;
  }
  if (/\.[cm]?jsx?$/.test(base)) {
    return /(^|\/)(dist|build|lib)\//.test(f) ? 55 : 65;
  }
  if (/\.mdx?$/.test(base)) {
    return 40;
  }
  if (/\.json$/.test(base)) {
    return 10;
  }
  return 30;
}

/**
 * Groups parsed lines into contiguous blocks (a match plus its context) and
 * ranks blocks by how many distinct query tokens they hit, then by file kind.
 * Ripgrep's own output order is file-traversal order, which put package.json
 * and README noise first; this puts type definitions and source first.
 */
export function rankSearchResults(
  lines: RipgrepLine[],
  tokens: string[],
  limit: number,
): ReferenceSearchResult[] {
  interface Block {
    file: string;
    endLine: number;
    matchLine: number | null;
    texts: string[];
  }
  const blocks: Block[] = [];
  let cur: Block | null = null;
  for (const l of lines) {
    if (cur && cur.file === l.file && l.line === cur.endLine + 1) {
      cur.texts.push(l.text);
      cur.endLine = l.line;
      if (l.isMatch && cur.matchLine === null) {
        cur.matchLine = l.line;
      }
    } else {
      if (cur) {
        blocks.push(cur);
      }
      cur = {
        file: l.file,
        endLine: l.line,
        matchLine: l.isMatch ? l.line : null,
        texts: [l.text],
      };
    }
  }
  if (cur) {
    blocks.push(cur);
  }

  const regexes = tokens.map((t) => new RegExp(wordBounded(t), 'i'));
  const scored = blocks.map((b, i) => {
    const text = b.texts.join('\n');
    const tokenHits = regexes.filter((r) => r.test(text)).length;
    return { b, i, score: tokenHits * 1000 + fileScore(b.file) };
  });
  scored.sort((x, y) => y.score - x.score || x.i - y.i);
  return scored.slice(0, limit).map(({ b }) => ({
    file: b.file,
    line: b.matchLine ?? b.endLine - b.texts.length + 1,
    snippet: b.texts.join('\n'),
  }));
}
