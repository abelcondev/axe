/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import { Storage } from '../../config/storage.js';
import { createDebugLogger } from '../../utils/debugLogger.js';
import {
  ensureRuntimeInstalled,
  getSemanticSearchStatus,
  getStoredHfToken,
  isValidHfToken,
  maskToken,
  resolveTransformers,
  setStoredHfToken,
} from './embedding-runtime.js';

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

let cached: Embedder | null = null;
let loading: Promise<Embedder | null> | null = null;
/** Pipeline construction failed (e.g. model download) — don't retry-loop. */
let sessionDisabled = false;
let provisioning: Promise<void> | null = null;

/**
 * Returns the embedding pipeline, lazily loaded. When the runtime module is
 * missing (bundle install channel), a background `npm install` into
 * `~/.axe/runtime` is kicked off ONCE and this call returns null — semantic
 * search degrades to keyword for now and activates when the install lands.
 * Never throws.
 */
export async function getEmbedder(): Promise<Embedder | null> {
  if (cached) {
    return cached;
  }
  if (sessionDisabled) {
    return null;
  }
  loading ??= load();
  return loading;
}

/** Clears all memoized state (used by tests and by explicit re-setup). */
export function resetEmbedderForTesting(): void {
  cached = null;
  loading = null;
  sessionDisabled = false;
  provisioning = null;
}

async function load(): Promise<Embedder | null> {
  const resolved = await resolveTransformers();
  if (!resolved) {
    // Auto-provision in the background; subsequent getEmbedder() calls
    // retry the (cheap) resolution until the install settles.
    provisioning ??= ensureRuntimeInstalled().then((ok) => {
      if (!ok) {
        sessionDisabled = true;
        debugLogger.warn(
          'Embedding runtime could not be provisioned — semantic reference search disabled for this session.',
        );
      }
    });
    loading = null;
    return null;
  }
  try {
    cached = await buildEmbedder(resolved.specifier);
    return cached;
  } catch (err) {
    sessionDisabled = true;
    debugLogger.warn(
      `Embedding pipeline unavailable, semantic reference search disabled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

async function buildEmbedder(specifier: string): Promise<Embedder> {
  // The stored token unlocks HF's anonymous CDN rate limit for the model
  // download; an explicitly exported HF_TOKEN always wins.
  const storedToken = await getStoredHfToken();
  if (storedToken && !process.env['HF_TOKEN']) {
    process.env['HF_TOKEN'] = storedToken;
  }

  const { pipeline, env } = await import(specifier);
  env.cacheDir = path.join(Storage.getGlobalQwenDir(), 'models');
  const extractor: (
    texts: string[],
    options: { pooling: 'mean'; normalize: boolean },
  ) => Promise<{ data: Float32Array; dims: number[] }> = await pipeline(
    'feature-extraction',
    EMBEDDING_MODEL,
    {
      dtype: 'q8',
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          debugLogger.debug(
            `Downloading ${EMBEDDING_MODEL}: ${Math.round(p.progress)}%`,
          );
        }
      },
    },
  );

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

export interface ProvisionStep {
  step: 'token' | 'runtime' | 'model' | 'verify';
  ok: boolean;
  detail: string;
}

/**
 * Eager, observable provisioning for `/references setup`: stores the token,
 * installs the runtime, downloads the model, and verifies with a test
 * embedding. Reports each step as it settles; stops at the first hard
 * failure (a missing token is not one — it is only needed when HF rate
 * limits the anonymous download).
 */
export async function provisionSemanticSearch(options?: {
  token?: string;
  onStep?: (step: ProvisionStep) => void;
}): Promise<ProvisionStep[]> {
  const steps: ProvisionStep[] = [];
  const report = (step: ProvisionStep): void => {
    steps.push(step);
    options?.onStep?.(step);
  };

  if (options?.token) {
    if (!isValidHfToken(options.token)) {
      report({
        step: 'token',
        ok: false,
        detail: 'Invalid token — expected the hf_… format.',
      });
      return steps;
    }
    await setStoredHfToken(options.token);
    report({
      step: 'token',
      ok: true,
      detail: `saved (${maskToken(options.token)})`,
    });
  } else {
    const status = await getSemanticSearchStatus(EMBEDDING_MODEL);
    report({
      step: 'token',
      ok: true,
      detail: status.token.set
        ? `already set via ${status.token.source} (${status.token.masked})`
        : 'not set — optional, needed only if the HF download is rate-limited',
    });
  }

  const runtimeOk = await ensureRuntimeInstalled();
  report({
    step: 'runtime',
    ok: runtimeOk,
    detail: runtimeOk
      ? 'installed'
      : 'npm install failed — is npm on your PATH? Re-run with debug logs for details.',
  });
  if (!runtimeOk) {
    return steps;
  }

  const hadModel = (await getSemanticSearchStatus(EMBEDDING_MODEL)).model
    .downloaded;
  resetEmbedderForTesting();
  const embedder = await getEmbedder();
  report({
    step: 'model',
    ok: embedder !== null,
    detail: embedder
      ? hadModel
        ? `${EMBEDDING_MODEL} already cached`
        : `${EMBEDDING_MODEL} downloaded to ~/.axe/models`
      : 'model download failed — set an HF token (`/references token hf_…`) and retry.',
  });
  if (!embedder) {
    return steps;
  }

  try {
    const start = Date.now();
    const vector = await embedder.embedQuery('verification probe');
    report({
      step: 'verify',
      ok: true,
      detail: `test embedding OK (${vector.length} dims, ${Date.now() - start}ms)`,
    });
  } catch (err) {
    report({
      step: 'verify',
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
  return steps;
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
