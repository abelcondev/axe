/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  buildSemanticIndex,
  loadSemanticIndex,
  saveSemanticIndex,
  searchSemanticIndex,
} from './semantic-index.js';
import type { SemanticIndex } from './semantic-index.js';
import { topKSimilar } from './embeddings.js';
import type { Embedder } from './embeddings.js';

const MODEL = 'test-model';

/** Deterministic fake: maps a text to a 2d unit vector by keyword. */
const fakeEmbedder: Embedder = {
  async embedDocuments(texts) {
    return texts.map((t) =>
      t.includes('auth') ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    );
  },
  async embedQuery(text) {
    return text.includes('auth')
      ? new Float32Array([1, 0])
      : new Float32Array([0, 1]);
  },
};

describe('topKSimilar', () => {
  it('ranks by dot product, applies the floor, and caps at k', () => {
    const query = new Float32Array([1, 0]);
    const vectors = [
      new Float32Array([0, 1]), // 0 — below floor
      new Float32Array([1, 0]), // 1
      new Float32Array([0.8, 0.6]), // 0.8
    ];
    const top = topKSimilar(query, vectors, 2, 0.4);
    expect(top.map((t) => t.index)).toEqual([1, 2]);
    expect(top[0].score).toBeCloseTo(1);
  });
});

describe('semantic index', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-semidx-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('builds from markdown docs and export signatures, then searches', async () => {
    await fs.writeFile(
      path.join(dir, 'README.md'),
      '## Auth\nSubscribe to auth state changes with subscribeAuth.\n\n## Storage\nUpload files with uploadFile and friends.',
      'utf8',
    );
    const index = await buildSemanticIndex(
      dir,
      [
        {
          name: 'subscribeAuth',
          kind: 'function',
          file: 'index.d.ts',
          signature: 'function subscribeAuth(cb: AuthCb): Unsubscribe',
        },
      ],
      fakeEmbedder,
      MODEL,
    );
    expect(index.chunks).toHaveLength(3);

    const results = searchSemanticIndex(
      index,
      await fakeEmbedder.embedQuery('auth changes'),
    );
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.snippet).toContain('auth');
    }
  });

  it('round-trips through save and load', async () => {
    const index: SemanticIndex = {
      version: 1,
      model: MODEL,
      dims: 2,
      chunks: [{ file: 'README.md', line: 3, text: 'auth docs section' }],
      vectors: [new Float32Array([0.6, 0.8])],
    };
    const file = path.join(dir, 'pkg.embeddings.json');
    await saveSemanticIndex(file, index);
    const loaded = await loadSemanticIndex(file, MODEL);
    expect(loaded).not.toBeNull();
    expect(loaded!.chunks).toEqual(index.chunks);
    expect([...loaded!.vectors[0]]).toEqual([
      ...index.vectors[0].map((x) => Math.fround(x)),
    ]);
  });

  it('rejects an index built by a different model', async () => {
    const file = path.join(dir, 'pkg.embeddings.json');
    await saveSemanticIndex(file, {
      version: 1,
      model: 'other-model',
      dims: 2,
      chunks: [{ file: 'a.md', line: 1, text: 'text long enough here' }],
      vectors: [new Float32Array([1, 0])],
    });
    expect(await loadSemanticIndex(file, MODEL)).toBeNull();
  });

  it('returns null for a missing or corrupt file', async () => {
    expect(await loadSemanticIndex(path.join(dir, 'nope.json'), MODEL)).toBe(
      null,
    );
    const bad = path.join(dir, 'bad.json');
    await fs.writeFile(bad, 'not json', 'utf8');
    expect(await loadSemanticIndex(bad, MODEL)).toBeNull();
  });
});
