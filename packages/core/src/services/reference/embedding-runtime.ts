/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Storage } from '../../config/storage.js';
import { execCommand } from '../../utils/shell-utils.js';
import { createDebugLogger } from '../../utils/debugLogger.js';

const debugLogger = createDebugLogger('EmbeddingRuntime');

export const TRANSFORMERS_PACKAGE = '@huggingface/transformers';
const TRANSFORMERS_SPEC = `${TRANSFORMERS_PACKAGE}@^4.2.0`;
const NPM_INSTALL_TIMEOUT_MS = 10 * 60_000;
const HF_TOKEN_RE = /^hf_[A-Za-z0-9]{10,}$/;

/**
 * The self-provisioned runtime dir. The curl-installed axe ships a bundle
 * with no node_modules, so optional native dependencies are installed here
 * on demand instead.
 */
export function getRuntimeDir(): string {
  return path.join(Storage.getGlobalQwenDir(), 'runtime');
}

function getTokenFile(): string {
  return path.join(Storage.getGlobalQwenDir(), 'hf-token');
}

export function isValidHfToken(token: string): boolean {
  return HF_TOKEN_RE.test(token.trim());
}

export async function getStoredHfToken(): Promise<string | null> {
  try {
    const token = (await fsp.readFile(getTokenFile(), 'utf8')).trim();
    return token || null;
  } catch {
    return null;
  }
}

export async function setStoredHfToken(token: string): Promise<void> {
  await fsp.mkdir(Storage.getGlobalQwenDir(), { recursive: true });
  await fsp.writeFile(getTokenFile(), `${token.trim()}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function clearStoredHfToken(): Promise<boolean> {
  try {
    await fsp.unlink(getTokenFile());
    return true;
  } catch {
    return false;
  }
}

/** Masks a token for display: `hf_…KWZL`. */
export function maskToken(token: string): string {
  return `hf_…${token.slice(-4)}`;
}

function runtimePackageDir(): string {
  return path.join(getRuntimeDir(), 'node_modules', TRANSFORMERS_PACKAGE);
}

/**
 * Resolves the transformers module without executing any of its code:
 * a bare specifier when it is installed alongside axe (npm channel / dev),
 * or a file URL into the self-provisioned runtime dir (bundle channel).
 */
export async function resolveTransformers(): Promise<{
  specifier: string;
  source: 'bundled' | 'runtime';
} | null> {
  try {
    createRequire(import.meta.url).resolve(TRANSFORMERS_PACKAGE);
    return { specifier: TRANSFORMERS_PACKAGE, source: 'bundled' };
  } catch {
    // Not resolvable from axe's own tree — check the runtime dir.
  }
  try {
    const pkgDir = runtimePackageDir();
    const pkg = JSON.parse(
      await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf8'),
    );
    const entry =
      pkg?.exports?.node?.import?.default ?? pkg?.module ?? pkg?.main;
    if (typeof entry !== 'string') {
      return null;
    }
    return {
      specifier: pathToFileURL(path.join(pkgDir, entry)).href,
      source: 'runtime',
    };
  } catch {
    return null;
  }
}

let installPromise: Promise<boolean> | null = null;

/**
 * Installs the embedding runtime into `~/.axe/runtime` with npm. Idempotent
 * and deduplicated: concurrent callers share one install. Returns whether
 * the module is resolvable afterwards.
 */
export function ensureRuntimeInstalled(): Promise<boolean> {
  installPromise ??= installRuntime().finally(() => {
    installPromise = null;
  });
  return installPromise;
}

async function installRuntime(): Promise<boolean> {
  if (await resolveTransformers()) {
    return true;
  }
  const runtimeDir = getRuntimeDir();
  await fsp.mkdir(runtimeDir, { recursive: true });
  debugLogger.debug(`Installing ${TRANSFORMERS_SPEC} into ${runtimeDir}…`);
  const { code, stderr } = await execCommand(
    'npm',
    [
      'install',
      '--prefix',
      runtimeDir,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      TRANSFORMERS_SPEC,
    ],
    { preserveOutputOnError: true, timeout: NPM_INSTALL_TIMEOUT_MS },
  );
  if (code !== 0) {
    debugLogger.warn(
      `Embedding runtime install failed (exit ${code}): ${stderr.slice(0, 400)}`,
    );
    return false;
  }
  return (await resolveTransformers()) !== null;
}

export interface SemanticSearchStatus {
  runtime: { installed: boolean; source: 'bundled' | 'runtime' | null };
  model: { downloaded: boolean; name: string };
  token: { set: boolean; source: 'stored' | 'env' | null; masked?: string };
  indexes: { count: number; bytes: number };
}

/** Cheap, fs-only status snapshot for the `/references` panel. */
export async function getSemanticSearchStatus(
  modelName: string,
): Promise<SemanticSearchStatus> {
  const resolved = await resolveTransformers();

  const modelDir = path.join(
    Storage.getGlobalQwenDir(),
    'models',
    ...modelName.split('/'),
  );
  let modelDownloaded = false;
  try {
    modelDownloaded = (await fsp.readdir(path.join(modelDir, 'onnx'))).some(
      (f) => f.endsWith('.onnx'),
    );
  } catch {
    // Model dir absent.
  }

  const envToken = process.env['HF_TOKEN']?.trim();
  const storedToken = await getStoredHfToken();
  const token: SemanticSearchStatus['token'] = envToken
    ? { set: true, source: 'env', masked: maskToken(envToken) }
    : storedToken
      ? { set: true, source: 'stored', masked: maskToken(storedToken) }
      : { set: false, source: null };

  let count = 0;
  let bytes = 0;
  try {
    const refsDir = Storage.getGlobalReferencesDir();
    for (const name of await fsp.readdir(refsDir)) {
      if (name.endsWith('.embeddings.json')) {
        count++;
        bytes += (await fsp.stat(path.join(refsDir, name))).size;
      }
    }
  } catch {
    // References dir absent.
  }

  return {
    runtime: {
      installed: resolved !== null,
      source: resolved?.source ?? null,
    },
    model: { downloaded: modelDownloaded, name: modelName },
    token,
    indexes: { count, bytes },
  };
}
