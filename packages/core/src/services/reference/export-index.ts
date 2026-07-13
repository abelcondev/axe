/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RipgrepLine } from './reference-service.js';
import type { ReferenceExport, ReferenceExportKind } from './types.js';

/** Cap on symbols kept per package — huge packages export thousands. */
const MAX_EXPORTS = 300;
/** Cap on a stored signature line. */
const MAX_SIGNATURE_CHARS = 160;

const DECLARATION_RE =
  /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|interface|type|const|let|var|enum|namespace)\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_RE =
  /^export\s+default\s+(?:(?:abstract\s+)?class|(?:async\s+)?function)?\s*([A-Za-z_$][\w$]*)?/;
const NAMESPACE_REEXPORT_RE = /^export\s*\*\s*as\s+([A-Za-z_$][\w$]*)/;
const BRACE_RE = /^export\s+(?:type\s+)?\{([^}]*)\}/;
const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;

const KIND_RANK: Record<ReferenceExportKind, number> = {
  function: 0,
  class: 1,
  interface: 2,
  type: 3,
  enum: 4,
  const: 5,
  namespace: 6,
  default: 7,
  reexport: 8,
};

interface ParsedExport {
  name: string;
  kind: ReferenceExportKind;
  /** True for a real declaration (carries a signature), false for re-exports. */
  declaration: boolean;
}

/**
 * Parses the exported names out of a single `export ...` line. Multi-line
 * `export { ... }` statements are missed (only the first line is matched) —
 * acceptable, since `.d.ts` re-exports are almost always single-line.
 */
function parseExportLine(text: string): ParsedExport[] {
  const decl = DECLARATION_RE.exec(text);
  if (decl) {
    const raw = decl[1];
    const kind: ReferenceExportKind =
      raw === 'let' || raw === 'var' ? 'const' : (raw as ReferenceExportKind);
    return [{ name: decl[2], kind, declaration: true }];
  }
  const def = DEFAULT_RE.exec(text);
  if (def) {
    return [{ name: def[1] ?? 'default', kind: 'default', declaration: true }];
  }
  const ns = NAMESPACE_REEXPORT_RE.exec(text);
  if (ns) {
    return [{ name: ns[1], kind: 'namespace', declaration: false }];
  }
  const brace = BRACE_RE.exec(text);
  if (brace) {
    const items: ParsedExport[] = [];
    for (const rawItem of brace[1].split(',')) {
      const item = rawItem.trim().replace(/^type\s+/, '');
      const parts = item.split(/\s+as\s+/);
      const name = parts[parts.length - 1]?.trim() ?? '';
      if (IDENTIFIER_RE.test(name)) {
        items.push({ name, kind: 'reexport', declaration: false });
      }
    }
    return items;
  }
  return [];
}

function cleanSignature(text: string): string {
  const sig = text
    .replace(/^export\s+(?:declare\s+)?/, '')
    .replace(/\s*[;{]\s*$/, '');
  return sig.length > MAX_SIGNATURE_CHARS
    ? `${sig.slice(0, MAX_SIGNATURE_CHARS)}…`
    : sig;
}

/** Hand-written type definitions describe the public API best. */
function filePreference(file: string): number {
  const f = file.toLowerCase();
  if (/\.d\.[cm]?ts$/.test(f)) {
    return 3;
  }
  if (/\.[cm]?tsx?$/.test(f)) {
    return 2;
  }
  return 1;
}

function depth(file: string): number {
  return file.split(/[\\/]/).length;
}

/**
 * Builds a deduplicated export table from ripgrep matches of `^export` lines.
 * Per name, a real declaration beats a re-export, `.d.ts` beats source beats
 * dist JS, and shallower files beat deeper ones. Output is sorted by kind,
 * then name.
 */
export function buildExportIndex(lines: RipgrepLine[]): ReferenceExport[] {
  const best = new Map<string, { exp: ReferenceExport; score: number }>();
  for (const line of lines) {
    if (!line.isMatch) {
      continue;
    }
    const text = line.text.trim();
    for (const item of parseExportLine(text)) {
      const score =
        (item.declaration ? 1000 : 0) +
        filePreference(line.file) * 100 -
        depth(line.file);
      const prev = best.get(item.name);
      if (!prev || score > prev.score) {
        best.set(item.name, {
          exp: {
            name: item.name,
            kind: item.kind,
            file: line.file,
            signature: item.declaration ? cleanSignature(text) : item.name,
          },
          score,
        });
      }
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXPORTS)
    .map(({ exp }) => exp)
    .sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.name.localeCompare(b.name),
    );
}
