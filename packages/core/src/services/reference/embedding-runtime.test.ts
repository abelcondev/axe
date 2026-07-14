/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const execCommand = vi.fn(async () => ({ stdout: '', stderr: '', code: 1 }));
vi.mock('../../utils/shell-utils.js', () => ({
  execCommand,
}));

const {
  clearStoredHfToken,
  ensureRuntimeInstalled,
  getSemanticSearchStatus,
  getStoredHfToken,
  isValidHfToken,
  maskToken,
  resolveTransformers,
  setStoredHfToken,
} = await import('./embedding-runtime.js');

describe('HF token storage', () => {
  let homeDir: string;
  let prevHome: string | undefined;
  let prevEnvToken: string | undefined;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-hf-'));
    prevHome = process.env['AXE_HOME'];
    process.env['AXE_HOME'] = homeDir;
    prevEnvToken = process.env['HF_TOKEN'];
    delete process.env['HF_TOKEN'];
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env['AXE_HOME'];
    } else {
      process.env['AXE_HOME'] = prevHome;
    }
    if (prevEnvToken !== undefined) {
      process.env['HF_TOKEN'] = prevEnvToken;
    }
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it('stores, reads, and clears the token', async () => {
    expect(await getStoredHfToken()).toBeNull();
    await setStoredHfToken('hf_abcdefghijklmnop');
    expect(await getStoredHfToken()).toBe('hf_abcdefghijklmnop');

    // Not world-readable.
    const mode = (await fs.stat(path.join(homeDir, 'hf-token'))).mode & 0o777;
    expect(mode).toBe(0o600);

    expect(await clearStoredHfToken()).toBe(true);
    expect(await getStoredHfToken()).toBeNull();
    expect(await clearStoredHfToken()).toBe(false);
  });

  it('validates the hf_ token format', () => {
    expect(isValidHfToken('hf_abcdefghijklmnop')).toBe(true);
    expect(isValidHfToken('  hf_abcdefghijklmnop  ')).toBe(true);
    expect(isValidHfToken('sk-something')).toBe(false);
    expect(isValidHfToken('hf_short')).toBe(false);
    expect(isValidHfToken('')).toBe(false);
  });

  it('masks tokens for display', () => {
    expect(maskToken('hf_abcdefghijKWZL')).toBe('hf_…KWZL');
  });

  it('reports semantic status: stored token, no model, no indexes', async () => {
    await setStoredHfToken('hf_abcdefghijklmnop');
    const status = await getSemanticSearchStatus('Xenova/bge-small-en-v1.5');
    expect(status.token).toEqual({
      set: true,
      source: 'stored',
      masked: 'hf_…mnop',
    });
    expect(status.model.downloaded).toBe(false);
    expect(status.indexes).toEqual({ count: 0, bytes: 0 });
    // In the dev tree the module is installed in node_modules.
    expect(status.runtime.installed).toBe(true);
    expect(status.runtime.source).toBe('bundled');
  });

  it('prefers the HF_TOKEN env var over the stored token', async () => {
    await setStoredHfToken('hf_storedstoredstored');
    process.env['HF_TOKEN'] = 'hf_envenvenvenvenv';
    const status = await getSemanticSearchStatus('Xenova/bge-small-en-v1.5');
    expect(status.token.source).toBe('env');
  });

  it('counts semantic index sidecars', async () => {
    const refsDir = path.join(homeDir, 'references');
    await fs.mkdir(refsDir, { recursive: true });
    await fs.writeFile(path.join(refsDir, 'a@1.0.0.embeddings.json'), '{}');
    await fs.writeFile(path.join(refsDir, 'b@2.0.0.embeddings.json'), '{}');
    await fs.writeFile(path.join(refsDir, 'manifest.json'), '{}');
    const status = await getSemanticSearchStatus('Xenova/bge-small-en-v1.5');
    expect(status.indexes.count).toBe(2);
  });
});

describe('runtime provisioning', () => {
  it('resolves the module from the dev tree without installing', async () => {
    const resolved = await resolveTransformers();
    expect(resolved).toEqual({
      specifier: '@huggingface/transformers',
      source: 'bundled',
    });

    execCommand.mockClear();
    expect(await ensureRuntimeInstalled()).toBe(true);
    // Already resolvable — no npm install ran.
    expect(execCommand).not.toHaveBeenCalled();
  });
});
