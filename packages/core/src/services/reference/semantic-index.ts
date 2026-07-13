/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createDebugLogger } from '../../utils/debugLogger.js';
import { chunkMarkdown } from './doc-chunks.js';
import type { SemanticChunk } from './doc-chunks.js';
import { topKSimilar } from './embeddings.js';
import type { Embedder } from './embeddings.js';
import type { ReferenceExport, ReferenceSearchResult } from './types.js';

const debugLogger = createDebugLogger('ReferenceSemanticIndex');

const INDEX_VERSION = 1;
/** Caps: a package's docs corpus, not a crawl of the whole clone. */
const MAX_DOC_FILES = 150;
const MAX_DOC_FILE_BYTES = 200 * 1024;
const MAX_CHUNKS = 4000;
const TOP_K = 8;
/** Normalized-cosine floor below which a hit is noise, not a neighbor. */
const MIN_SCORE = 0.4;

export interface SemanticIndex {
  version: number;
  model: string;
  dims: number;
  chunks: SemanticChunk[];
  vectors: Float32Array[];
}

/** Serialized form: chunk metadata as JSON, vectors as one base64 blob. */
interface SemanticIndexFile {
  version: number;
  model: string;
  dims: number;
  chunks: SemanticChunk[];
  vectors: string;
}

export async function loadSemanticIndex(
  file: string,
  model: string,
): Promise<SemanticIndex | null> {
  let parsed: SemanticIndexFile;
  try {
    parsed = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return null;
  }
  if (
    parsed.version !== INDEX_VERSION ||
    parsed.model !== model ||
    !Array.isArray(parsed.chunks) ||
    typeof parsed.vectors !== 'string'
  ) {
    return null;
  }
  const raw = Buffer.from(parsed.vectors, 'base64');
  const all = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );
  const { dims } = parsed;
  if (all.length !== parsed.chunks.length * dims) {
    return null;
  }
  const vectors: Float32Array[] = [];
  for (let i = 0; i < parsed.chunks.length; i++) {
    vectors.push(all.slice(i * dims, (i + 1) * dims));
  }
  return {
    version: parsed.version,
    model,
    dims,
    chunks: parsed.chunks,
    vectors,
  };
}

export async function saveSemanticIndex(
  file: string,
  index: SemanticIndex,
): Promise<void> {
  const all = new Float32Array(index.chunks.length * index.dims);
  index.vectors.forEach((v, i) => all.set(v, i * index.dims));
  const payload: SemanticIndexFile = {
    version: index.version,
    model: index.model,
    dims: index.dims,
    chunks: index.chunks,
    vectors: Buffer.from(all.buffer).toString('base64'),
  };
  try {
    await fsp.writeFile(file, JSON.stringify(payload), 'utf8');
  } catch (err) {
    debugLogger.warn(
      `Failed to persist semantic index: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Recursively collects markdown files under `root`, capped and skipping noise. */
async function collectDocFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (found.length >= MAX_DOC_FILES) {
      return;
    }
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_DOC_FILES) {
        return;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (
        entry.isFile() &&
        /\.mdx?$/i.test(entry.name) &&
        !/^(changelog|license|contributing|code_of_conduct)/i.test(entry.name)
      ) {
        found.push(full);
      }
    }
  };
  await walk(root);
  return found;
}

/**
 * Builds the semantic index for a package: markdown docs chunked by heading
 * plus one chunk per exported symbol (its signature). Embedding cost is paid
 * once — the caller persists the result next to the source cache.
 */
export async function buildSemanticIndex(
  cachePath: string,
  exports: ReferenceExport[],
  embedder: Embedder,
  model: string,
  signal?: AbortSignal,
): Promise<SemanticIndex> {
  const chunks: SemanticChunk[] = [];
  for (const file of await collectDocFiles(cachePath)) {
    let content: string;
    try {
      const stat = await fsp.stat(file);
      if (stat.size > MAX_DOC_FILE_BYTES) {
        continue;
      }
      content = await fsp.readFile(file, 'utf8');
    } catch {
      continue;
    }
    chunks.push(...chunkMarkdown(path.relative(cachePath, file), content));
    if (chunks.length >= MAX_CHUNKS) {
      break;
    }
  }
  for (const exp of exports) {
    chunks.push({ file: exp.file, line: 1, text: exp.signature });
  }
  const bounded = chunks.slice(0, MAX_CHUNKS);

  const start = Date.now();
  const vectors = await embedder.embedDocuments(
    bounded.map((c) => c.text),
    signal,
  );
  debugLogger.debug(
    `Embedded ${bounded.length} chunk(s) in ${Date.now() - start}ms`,
  );
  return {
    version: INDEX_VERSION,
    model,
    dims: vectors[0]?.length ?? 0,
    chunks: bounded,
    vectors,
  };
}

/** Returns the top semantic neighbors of `queryVector` as search results. */
export function searchSemanticIndex(
  index: SemanticIndex,
  queryVector: Float32Array,
): ReferenceSearchResult[] {
  return topKSimilar(queryVector, index.vectors, TOP_K, MIN_SCORE).map(
    ({ index: i }) => ({
      file: index.chunks[i].file,
      line: index.chunks[i].line,
      snippet: index.chunks[i].text,
    }),
  );
}
