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

/** A line-level match returned by {@link IReferenceService.search}. */
export interface ReferenceSearchResult {
  /** Path relative to the package's indexed source root. */
  file: string;
  /** 1-based line number of the match. */
  line: number;
  /** Trimmed content of the matching line. */
  snippet: string;
}

/** Outcome of a {@link IReferenceService.search} call. */
export interface ReferenceSearchOutcome {
  results: ReferenceSearchResult[];
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
   * Searches an indexed package's source for `query`. Indexes it on demand if
   * needed.
   */
  search(
    packageName: string,
    query: string,
    signal?: AbortSignal,
  ): Promise<ReferenceSearchOutcome>;
}
