/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as yamlParser from '../../utils/yaml-parser.js';
import { createDebugLogger } from '../../utils/debugLogger.js';
import type {
  IKnowledgeService,
  KnowledgeConcept,
  KnowledgeConceptType,
  KnowledgeSearchResult,
} from './types.js';

const debugLogger = createDebugLogger('KnowledgeService');

/** Files at the `sdd/` root that are dashboards, not OKF concepts. */
const NON_CONCEPT_FILES = new Set(['index.md', 'log.md']);

/** Cap on search matches returned to the model. */
const MAX_SEARCH_RESULTS = 30;

const VALID_TYPES: ReadonlySet<string> = new Set([
  'Proposal',
  'Decision',
  'Task',
]);

/**
 * Splits a markdown document into its YAML frontmatter data and body. Returns
 * empty data when the document has no `---` delimited frontmatter block.
 *
 * Mirrors the frontmatter handling used by the subagent and skill loaders.
 */
function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith('---')) {
    return { data: {}, body: content };
  }
  // Closing delimiter on its own line.
  const end = content.indexOf('\n---', 3);
  if (end === -1) {
    return { data: {}, body: content };
  }
  const raw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\r?\n/, '');
  try {
    return { data: yamlParser.parse(raw), body };
  } catch {
    return { data: {}, body };
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/**
 * Indexes an `sdd/` Open Knowledge Format bundle so the agent can (a) see a
 * summary of prior decisions/tasks/proposals in its system prompt and (b)
 * search the bundle at runtime via the Knowledge tool.
 */
export class KnowledgeService implements IKnowledgeService {
  private ready = false;
  private sddRoot: string | null = null;
  private concepts: KnowledgeConcept[] = [];
  /** Absolute paths of every `.md` file under `sdd/`, for search. */
  private files: string[] = [];

  /**
   * Creates a standalone instance. Kept as a static factory to mirror the
   * wiring of the other core services (e.g. ReferenceService).
   */
  static createStandalone(): KnowledgeService {
    return new KnowledgeService();
  }

  async initialize(cwd: string): Promise<void> {
    this.ready = true;
    this.sddRoot = null;
    this.concepts = [];
    this.files = [];

    try {
      const root = await findSddRoot(cwd);
      if (!root) {
        return;
      }
      this.sddRoot = root;
      const mdFiles = await collectMarkdownFiles(root);
      this.files = mdFiles;

      for (const file of mdFiles) {
        const rel = path.relative(root, file);
        // Skip top-level dashboards and any template scaffolding.
        const base = path.basename(file);
        if (NON_CONCEPT_FILES.has(rel) || base.startsWith('_')) {
          continue;
        }
        try {
          const content = await fsp.readFile(file, 'utf8');
          const { data } = parseFrontmatter(content);
          const type = asString(data['type']);
          if (!type || !VALID_TYPES.has(type)) {
            continue;
          }
          this.concepts.push({
            type: type as KnowledgeConceptType,
            title: asString(data['title']) ?? base.replace(/\.md$/, ''),
            description: asString(data['description']),
            status: asString(data['status']),
            tags: Array.isArray(data['tags'])
              ? (data['tags'] as unknown[]).map(String)
              : undefined,
            timestamp: asString(data['timestamp']),
            file,
            relativePath: rel,
          });
        } catch (err) {
          debugLogger.warn(
            `Failed to parse concept ${file}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
      debugLogger.debug(
        `Indexed ${this.concepts.length} concept(s) from ${root}`,
      );
    } catch (err) {
      debugLogger.warn(
        `KnowledgeService initialize failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  hasKnowledge(): boolean {
    return this.sddRoot !== null && this.concepts.length > 0;
  }

  getSddRoot(): string | null {
    return this.sddRoot;
  }

  getSummary(): string {
    if (!this.hasKnowledge()) {
      return '';
    }
    const order: KnowledgeConceptType[] = ['Decision', 'Task', 'Proposal'];
    const heading: Record<KnowledgeConceptType, string> = {
      Decision: 'Decisions',
      Task: 'Tasks',
      Proposal: 'Proposals',
    };

    const lines: string[] = [];
    for (const type of order) {
      const group = this.concepts.filter((c) => c.type === type);
      if (group.length === 0) {
        continue;
      }
      lines.push(`### ${heading[type]}`);
      for (const c of group) {
        const status = c.status ? ` _(status: ${c.status})_` : '';
        const desc = c.description ? ` — ${c.description}` : '';
        lines.push(`- **${c.title}**${desc}${status} · \`${c.relativePath}\``);
      }
      lines.push('');
    }
    return lines.join('\n').trimEnd();
  }

  async search(
    query: string,
    type?: KnowledgeConceptType,
  ): Promise<KnowledgeSearchResult[]> {
    const trimmed = query.trim();
    if (!this.sddRoot || !trimmed) {
      return [];
    }
    const needle = trimmed.toLowerCase();

    // When a type filter is given, restrict to files backing that concept type.
    let candidates = this.files;
    if (type) {
      const typedFiles = new Set(
        this.concepts.filter((c) => c.type === type).map((c) => c.file),
      );
      candidates = this.files.filter((f) => typedFiles.has(f));
    }

    const results: KnowledgeSearchResult[] = [];
    for (const file of candidates) {
      if (results.length >= MAX_SEARCH_RESULTS) {
        break;
      }
      let content: string;
      try {
        content = await fsp.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const rel = path.relative(this.sddRoot, file);
      const fileLines = content.split('\n');
      for (let i = 0; i < fileLines.length; i++) {
        if (fileLines[i].toLowerCase().includes(needle)) {
          results.push({
            file: rel,
            line: i + 1,
            snippet: fileLines[i].trim(),
          });
          if (results.length >= MAX_SEARCH_RESULTS) {
            break;
          }
        }
      }
    }
    return results;
  }
}

/**
 * Walks up from `startDir` looking for a directory named `sdd`. Returns the
 * absolute path to the `sdd/` directory, or null if none is found before the
 * filesystem root.
 */
async function findSddRoot(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  // Bound the walk by the number of path segments to avoid an infinite loop.
  for (let depth = 0; depth < 64; depth++) {
    const candidate = path.join(current, 'sdd');
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // Not here; keep walking up.
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Recursively collects every `.md` file under `root`.
 */
async function collectMarkdownFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}
