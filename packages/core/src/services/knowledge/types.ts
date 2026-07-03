/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Open Knowledge Format (OKF) concept types. Each concept is a markdown file
 * under `sdd/` with YAML frontmatter declaring its `type`.
 */
export type KnowledgeConceptType = 'Proposal' | 'Decision' | 'Task';

/**
 * A single OKF concept parsed from an `sdd/` markdown file.
 */
export interface KnowledgeConcept {
  type: KnowledgeConceptType;
  title: string;
  description?: string;
  status?: string;
  tags?: string[];
  timestamp?: string;
  /** Absolute path to the source file. */
  file: string;
  /** Path relative to the project's `sdd/` root (e.g. `decisions/001-x.md`). */
  relativePath: string;
}

/**
 * A line-level match returned by {@link IKnowledgeService.search}.
 */
export interface KnowledgeSearchResult {
  /** Path relative to the `sdd/` root. */
  file: string;
  /** 1-based line number of the match. */
  line: number;
  /** Trimmed content of the matching line. */
  snippet: string;
}

export interface IKnowledgeService {
  /**
   * Walks up from `cwd` to locate an `sdd/` directory, then parses the
   * frontmatter of every concept file. Never throws — a missing or malformed
   * bundle simply leaves the service empty.
   */
  initialize(cwd: string): Promise<void>;
  /** True once {@link initialize} has run (regardless of whether `sdd/` exists). */
  isReady(): boolean;
  /** True when an `sdd/` bundle was found and at least one concept parsed. */
  hasKnowledge(): boolean;
  /** Absolute path to the discovered `sdd/` directory, or null if none. */
  getSddRoot(): string | null;
  /**
   * Renders a compact, type-grouped index of the knowledge base for injection
   * into the system prompt. Returns an empty string when there is no bundle.
   */
  getSummary(): string;
  /**
   * Case-insensitive, line-by-line search across the `sdd/` bundle. When
   * `type` is given, only files whose concept matches that type are searched.
   */
  search(
    query: string,
    type?: KnowledgeConceptType,
  ): Promise<KnowledgeSearchResult[]>;
}
