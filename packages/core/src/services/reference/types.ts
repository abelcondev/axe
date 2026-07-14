/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

/** Where a reference's source was obtained from. */
export type ReferenceSource = 'git' | 'local' | 'npm';

/** Lifecycle state of a single reference in the manifest. */
export type ReferenceStatus = 'indexed' | 'pending' | 'error';

/**
 * A production dependency that is a candidate for indexing, resolved from the
 * active workspace / repo root at {@link IReferenceService.initialize} time.
 */
export interface ActivePackage {
  /** Registry package name (source is fetched for this). */
  name: string;
  /** Name the package is installed under in `node_modules`. */
  installName: string;
  /** Cleaned version (range operators stripped) or `latest`. */
  version: string;
  /** Resolved install dir, when found via an on-demand node_modules lookup. */
  localPath?: string;
}

/**
 * One entry in the on-disk manifest, describing an indexed (or failed) package
 * source under `~/.axe/references/`.
 */
export interface ReferenceEntry {
  package: string;
  version: string;
  source: ReferenceSource;
  repo?: string;
  clonedAt?: string;
  indexedAt?: string;
  /** Total size in bytes of the indexed source tree. */
  size: number;
  fileCount: number;
  status: ReferenceStatus;
  /** Present when `status === 'error'`. */
  error?: string;
  /** Absolute path to the indexed source directory. */
  cachePath?: string;
}

/**
 * Persisted index of every reference the service has attempted, keyed by
 * `"<package>@<version>"`.
 */
export interface ReferenceManifest {
  version: number;
  references: Record<string, ReferenceEntry>;
}

/** Kind of an exported symbol (let/var declarations are folded into const). */
export type ReferenceExportKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'const'
  | 'namespace'
  | 'default'
  | 'reexport';

/** One exported symbol extracted from a package's indexed source. */
export interface ReferenceExport {
  /** Public exported name. */
  name: string;
  kind: ReferenceExportKind;
  /** Path relative to the package's indexed source root. */
  file: string;
  /**
   * The declaration line with the `export (declare)` prefix stripped
   * (e.g. `function sendMagicCode(params: P): Promise<R>`); the bare name
   * for re-exports.
   */
  signature: string;
}

/** Outcome of a {@link IReferenceService.getExports} call. */
export interface ReferenceExportsOutcome {
  exports: ReferenceExport[];
  /** The resolved manifest entry, when the package is (or became) indexed. */
  entry?: ReferenceEntry;
  /** Same semantics as {@link ReferenceSearchOutcome.reason}. */
  reason?: 'not-a-dependency' | 'pending' | 'errored';
  detail?: string;
}

/** A ranked match block returned by {@link IReferenceService.search}. */
export interface ReferenceSearchResult {
  /** Path relative to the package's indexed source root. */
  file: string;
  /** 1-based line number of the (first) matching line in the block. */
  line: number;
  /** The matching line(s) plus surrounding context; may span multiple lines. */
  snippet: string;
}

/** Outcome of a {@link IReferenceService.search} call. */
export interface ReferenceSearchOutcome {
  results: ReferenceSearchResult[];
  /**
   * Semantic neighbors (doc sections and export signatures) ranked against
   * the query. Present whenever the embedding runtime is ready and the
   * package's semantic index exists (built on demand); absent otherwise.
   */
  semantic?: ReferenceSearchResult[];
  /** The resolved manifest entry, when the package is (or became) indexed. */
  entry?: ReferenceEntry;
  /**
   * Set when no search could run. One of: `not-a-dependency`, `pending`,
   * `errored`. Absent on a successful search (even with zero matches).
   */
  reason?: 'not-a-dependency' | 'pending' | 'errored';
  /** Human-readable detail for `reason` (e.g. the persisted error message). */
  detail?: string;
}

export interface IReferenceService {
  /**
   * Resolves the active package set for `cwd` (monorepo-aware) and loads the
   * manifest. Fast and non-blocking — it does not fetch any source. Never
   * throws.
   */
  initialize(cwd: string): Promise<void>;
  /**
   * Re-runs {@link initialize} with the last cwd so dependencies installed
   * mid-session become visible without a restart. No-op before initialize.
   */
  rescan(): Promise<void>;
  /** True once {@link initialize} has run. */
  isReady(): boolean;
  /** The production dependencies eligible for indexing. */
  getActivePackages(): ActivePackage[];
  /** The manifest's reference entries, keyed by `"<package>@<version>"`. */
  getManifest(): Record<string, ReferenceEntry>;
  /**
   * Removes cached source and manifest entries. With a package name, clears
   * only that package's entries; otherwise clears all. Returns the count
   * removed.
   */
  clear(packageName?: string): Promise<number>;
  /**
   * Renders a compact list of the active references (with per-package status)
   * for injection into the system prompt. Empty string when there are none.
   */
  getSummary(): string;
  /**
   * Fetches + indexes every active package that isn't already indexed, bounded
   * by a small concurrency limit. Resolves when the sweep settles.
   */
  warmup(): Promise<void>;
  /**
   * Ensures a single package is indexed, de-duplicating concurrent requests.
   * Returns the manifest entry, or null when the package is not an active
   * dependency.
   */
  ensureIndexed(
    packageName: string,
    options?: { force?: boolean },
  ): Promise<ReferenceEntry | null>;
  /**
   * Resolves an installed package by name — an active dependency or a
   * transitive one found in node_modules — without indexing it. Null when
   * the package is not installed.
   */
  resolveInstalled(packageName: string): Promise<ActivePackage | null>;
  /**
   * Searches an indexed package's source for `query`. Indexes it on demand if
   * needed.
   */
  search(
    packageName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<ReferenceSearchOutcome>;
  /**
   * Lists the exported API surface of an indexed package (extracted from its
   * source on first call, cached for the session). Indexes on demand if
   * needed.
   */
  getExports(
    packageName: string,
    signal?: AbortSignal,
  ): Promise<ReferenceExportsOutcome>;
}
