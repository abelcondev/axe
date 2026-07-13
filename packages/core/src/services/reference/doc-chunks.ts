/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

/** One embeddable unit of a package's docs or API surface. */
export interface SemanticChunk {
  /** Path relative to the package's indexed source root. */
  file: string;
  /** 1-based line where the chunk starts. */
  line: number;
  text: string;
}

/** Chunks below this length carry no retrievable signal. */
const MIN_CHUNK_CHARS = 30;
/** Rough budget keeping a chunk within the model's 512-token window. */
const MAX_CHUNK_CHARS = 1500;

/**
 * Splits a markdown document into heading-delimited sections, one chunk per
 * section (heading included). Sections longer than the chunk budget are
 * split further on paragraph boundaries, repeating the heading so every
 * piece keeps its context.
 */
export function chunkMarkdown(file: string, content: string): SemanticChunk[] {
  const lines = content.split('\n');
  const sections: Array<{ line: number; heading: string; body: string[] }> = [
    { line: 1, heading: '', body: [] },
  ];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
    }
    if (!inFence && /^#{1,6}\s/.test(line)) {
      sections.push({ line: i + 1, heading: line, body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const chunks: SemanticChunk[] = [];
  for (const section of sections) {
    const body = section.body.join('\n').trim();
    const full = [section.heading, body].filter(Boolean).join('\n');
    if (full.length < MIN_CHUNK_CHARS) {
      continue;
    }
    if (full.length <= MAX_CHUNK_CHARS) {
      chunks.push({ file, line: section.line, text: full });
      continue;
    }
    // Oversized section: pack paragraphs into budget-sized pieces.
    const headingPrefix = section.heading ? `${section.heading}\n` : '';
    const budget = MAX_CHUNK_CHARS - headingPrefix.length;
    let piece = '';
    for (const paragraph of body.split(/\n{2,}/)) {
      const para = paragraph.slice(0, budget);
      if (piece && piece.length + para.length + 2 > budget) {
        chunks.push({
          file,
          line: section.line,
          text: headingPrefix + piece,
        });
        piece = '';
      }
      piece = piece ? `${piece}\n\n${para}` : para;
    }
    if (piece.length >= MIN_CHUNK_CHARS) {
      chunks.push({ file, line: section.line, text: headingPrefix + piece });
    }
  }
  return chunks;
}
