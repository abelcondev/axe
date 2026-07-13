/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { Storage } from '../../config/storage.js';
import { createDebugLogger } from '../../utils/debugLogger.js';

const debugLogger = createDebugLogger('ReferenceEmbeddings');

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
/** BGE retrieval works best when queries (not documents) carry this prefix. */
const QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';
const BATCH_SIZE = 32;

export interface Embedder {
  /** Embeds document chunks. Vectors are L2-normalized (cosine = dot). */
  embedDocuments(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<Float32Array[]>;
  /** Embeds a retrieval query (BGE instruction prefix applied). */
  embedQuery(text: string): Promise<Float32Array>;
}

let embedderPromise: Promise<Embedder | null> | null = null;

/**
 * Lazily loads the embedding pipeline. `@huggingface/transformers` is an
 * optional dependency carrying native onnxruntime binaries — when it is not
 * installed (or fails to load on this platform), semantic search silently
 * degrades to keyword-only. The model (~34MB) is downloaded to
 * `~/.axe/models/` on first use and cached from then on.
 */
export function getEmbedder(): Promise<Embedder | null> {
  embedderPromise ??= loadEmbedder();
  return embedderPromise;
}

/** Test hook: clears the memoized pipeline. */
export function resetEmbedderForTesting(): void {
  embedderPromise = null;
}

async function loadEmbedder(): Promise<Embedder | null> {
  let extractor: (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ data: Float32Array; dims: number[] }>;
  try {
    const specifier = '@huggingface/transformers';
    const { pipeline, env } = await import(specifier);
    env.cacheDir = path.join(Storage.getGlobalQwenDir(), 'models');
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'q8',
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          debugLogger.debug(
            `Downloading ${EMBEDDING_MODEL}: ${Math.round(p.progress)}%`,
          );
        }
      },
    });
  } catch (err) {
    debugLogger.warn(
      `Embedding runtime unavailable, semantic reference search disabled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const embedBatch = async (texts: string[]): Promise<Float32Array[]> => {
    const output = await extractor(texts, {
      pooling: 'mean',
      normalize: true,
    });
    const [rows, dims] = output.dims;
    const vectors: Float32Array[] = [];
    for (let i = 0; i < rows; i++) {
      vectors.push(output.data.slice(i * dims, (i + 1) * dims));
    }
    return vectors;
  };

  return {
    async embedDocuments(texts, signal) {
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        signal?.throwIfAborted();
        vectors.push(...(await embedBatch(texts.slice(i, i + BATCH_SIZE))));
      }
      return vectors;
    },
    async embedQuery(text) {
      const [vector] = await embedBatch([QUERY_PREFIX + text]);
      return vector;
    },
  };
}

/**
 * Top-k most similar vectors by dot product (inputs are L2-normalized, so
 * dot product equals cosine similarity). Entries below `minScore` are
 * dropped.
 */
export function topKSimilar(
  query: Float32Array,
  vectors: readonly Float32Array[],
  k: number,
  minScore: number,
): Array<{ index: number; score: number }> {
  const scored: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    let dot = 0;
    for (let j = 0; j < v.length; j++) {
      dot += query[j] * v[j];
    }
    if (dot >= minScore) {
      scored.push({ index: i, score: dot });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
