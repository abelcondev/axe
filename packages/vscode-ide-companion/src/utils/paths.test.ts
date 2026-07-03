/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import {
  getGlobalQwenDir,
  getRuntimeBaseDir,
  resetEnvBootstrapForTesting,
} from './paths.js';

/**
 * Each test gets a clean temp homedir (no `.env` files), so the lazy
 * `bootstrapHomeEnvOverrides()` becomes a no-op unless the test explicitly
 * writes `.env` content into the mocked home. ESM bans spying on `os.homedir`,
 * so we redirect via the underlying `HOME` / `USERPROFILE` env vars.
 */
function withCleanHome() {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-paths-test-'));
  const realHome = fs.realpathSync(tempHome);
  const originalHomeEnv = process.env['HOME'];
  const originalUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = realHome;
  process.env['USERPROFILE'] = realHome;
  return {
    tempHome: realHome,
    cleanup: () => {
      if (originalHomeEnv !== undefined) {
        process.env['HOME'] = originalHomeEnv;
      } else {
        delete process.env['HOME'];
      }
      if (originalUserProfile !== undefined) {
        process.env['USERPROFILE'] = originalUserProfile;
      } else {
        delete process.env['USERPROFILE'];
      }
      fs.rmSync(realHome, { recursive: true, force: true });
    },
  };
}

describe('vscode-ide-companion paths – getGlobalQwenDir', () => {
  const originalEnv = process.env['AXE_HOME'];
  let home: ReturnType<typeof withCleanHome>;

  beforeEach(() => {
    resetEnvBootstrapForTesting();
    home = withCleanHome();
  });

  afterEach(() => {
    home.cleanup();
    if (originalEnv !== undefined) {
      process.env['AXE_HOME'] = originalEnv;
    } else {
      delete process.env['AXE_HOME'];
    }
  });

  it('defaults to ~/.qwen when AXE_HOME is not set', () => {
    delete process.env['AXE_HOME'];
    expect(getGlobalQwenDir()).toBe(path.join(home.tempHome, '.qwen'));
  });

  it('uses AXE_HOME when set to absolute path', () => {
    const configDir = path.resolve('/tmp/custom-qwen');
    process.env['AXE_HOME'] = configDir;
    expect(getGlobalQwenDir()).toBe(configDir);
  });

  it('resolves relative AXE_HOME against process.cwd', () => {
    process.env['AXE_HOME'] = 'relative/config';
    expect(getGlobalQwenDir()).toBe(path.resolve('relative/config'));
  });

  it('expands tilde (~/x) in AXE_HOME', () => {
    process.env['AXE_HOME'] = '~/custom-qwen';
    expect(getGlobalQwenDir()).toBe(path.join(home.tempHome, 'custom-qwen'));
  });

  it('expands Windows-style tilde (~\\x) in AXE_HOME', () => {
    process.env['AXE_HOME'] = '~\\custom-qwen';
    expect(getGlobalQwenDir()).toBe(path.join(home.tempHome, 'custom-qwen'));
  });

  it('treats bare tilde (~) as home directory', () => {
    process.env['AXE_HOME'] = '~';
    expect(getGlobalQwenDir()).toBe(home.tempHome);
  });
});

describe('vscode-ide-companion paths – getRuntimeBaseDir', () => {
  const originalHome = process.env['AXE_HOME'];
  const originalRuntime = process.env['AXE_RUNTIME_DIR'];
  let home: ReturnType<typeof withCleanHome>;

  beforeEach(() => {
    resetEnvBootstrapForTesting();
    home = withCleanHome();
  });

  afterEach(() => {
    home.cleanup();
    if (originalHome !== undefined) {
      process.env['AXE_HOME'] = originalHome;
    } else {
      delete process.env['AXE_HOME'];
    }
    if (originalRuntime !== undefined) {
      process.env['AXE_RUNTIME_DIR'] = originalRuntime;
    } else {
      delete process.env['AXE_RUNTIME_DIR'];
    }
  });

  it('falls back to getGlobalQwenDir() when neither env var is set', () => {
    delete process.env['AXE_HOME'];
    delete process.env['AXE_RUNTIME_DIR'];
    expect(getRuntimeBaseDir()).toBe(getGlobalQwenDir());
  });

  it('uses AXE_RUNTIME_DIR when set to absolute path', () => {
    delete process.env['AXE_HOME'];
    const runtimeDir = path.resolve('/tmp/custom-runtime');
    process.env['AXE_RUNTIME_DIR'] = runtimeDir;
    expect(getRuntimeBaseDir()).toBe(runtimeDir);
  });

  it('resolves relative AXE_RUNTIME_DIR against process.cwd', () => {
    delete process.env['AXE_HOME'];
    process.env['AXE_RUNTIME_DIR'] = 'relative/runtime';
    expect(getRuntimeBaseDir()).toBe(path.resolve('relative/runtime'));
  });

  it('expands tilde (~/x) in AXE_RUNTIME_DIR', () => {
    delete process.env['AXE_HOME'];
    process.env['AXE_RUNTIME_DIR'] = '~/custom-runtime';
    expect(getRuntimeBaseDir()).toBe(
      path.join(home.tempHome, 'custom-runtime'),
    );
  });

  it('falls back to AXE_HOME when AXE_RUNTIME_DIR is unset', () => {
    delete process.env['AXE_RUNTIME_DIR'];
    const configDir = path.resolve('/tmp/custom-qwen');
    process.env['AXE_HOME'] = configDir;
    expect(getRuntimeBaseDir()).toBe(configDir);
  });

  it('AXE_RUNTIME_DIR takes priority over AXE_HOME', () => {
    const configDir = path.resolve('/tmp/custom-qwen');
    const runtimeDir = path.resolve('/tmp/custom-runtime');
    process.env['AXE_HOME'] = configDir;
    process.env['AXE_RUNTIME_DIR'] = runtimeDir;
    expect(getRuntimeBaseDir()).toBe(runtimeDir);
  });
});

describe('vscode-ide-companion paths – .env bootstrap', () => {
  const originalHome = process.env['AXE_HOME'];
  const originalRuntime = process.env['AXE_RUNTIME_DIR'];
  let home: ReturnType<typeof withCleanHome>;

  beforeEach(() => {
    resetEnvBootstrapForTesting();
    home = withCleanHome();
    delete process.env['AXE_HOME'];
    delete process.env['AXE_RUNTIME_DIR'];
  });

  afterEach(() => {
    home.cleanup();
    if (originalHome !== undefined) {
      process.env['AXE_HOME'] = originalHome;
    } else {
      delete process.env['AXE_HOME'];
    }
    if (originalRuntime !== undefined) {
      process.env['AXE_RUNTIME_DIR'] = originalRuntime;
    } else {
      delete process.env['AXE_RUNTIME_DIR'];
    }
  });

  it('reads AXE_HOME from <homedir>/.qwen/.env', () => {
    const configDir = path.resolve('/tmp/from-qwen-dotenv');
    fs.mkdirSync(path.join(home.tempHome, '.qwen'), { recursive: true });
    fs.writeFileSync(
      path.join(home.tempHome, '.qwen', '.env'),
      `AXE_HOME=${configDir}\n`,
    );
    expect(getGlobalQwenDir()).toBe(configDir);
    expect(process.env['AXE_HOME']).toBe(configDir);
  });

  it('reads AXE_HOME from <homedir>/.env when ~/.qwen/.env is absent', () => {
    const configDir = path.resolve('/tmp/from-home-dotenv');
    fs.writeFileSync(
      path.join(home.tempHome, '.env'),
      `AXE_HOME=${configDir}\n`,
    );
    expect(getGlobalQwenDir()).toBe(configDir);
    expect(process.env['AXE_HOME']).toBe(configDir);
  });

  it('process env wins over .env file', () => {
    const envDir = path.resolve('/tmp/from-process-env');
    const dotenvDir = path.resolve('/tmp/from-dotenv');
    process.env['AXE_HOME'] = envDir;
    fs.mkdirSync(path.join(home.tempHome, '.qwen'), { recursive: true });
    fs.writeFileSync(
      path.join(home.tempHome, '.qwen', '.env'),
      `AXE_HOME=${dotenvDir}\n`,
    );
    expect(getGlobalQwenDir()).toBe(envDir);
  });

  it('reads AXE_RUNTIME_DIR from <AXE_HOME>/.env when AXE_HOME is preset', () => {
    const configDir = path.join(home.tempHome, 'custom-qwen');
    const runtimeDir = path.resolve('/tmp/from-runtime-dotenv');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, '.env'),
      `AXE_RUNTIME_DIR=${runtimeDir}\n`,
    );
    process.env['AXE_HOME'] = configDir;
    expect(getRuntimeBaseDir()).toBe(runtimeDir);
  });

  it('does not read <homedir>/.env when AXE_HOME is preset', () => {
    const configDir = path.resolve('/tmp/preset-qwen-home');
    process.env['AXE_HOME'] = configDir;
    fs.writeFileSync(
      path.join(home.tempHome, '.env'),
      `AXE_RUNTIME_DIR=/tmp/should-be-ignored\n`,
    );
    expect(getRuntimeBaseDir()).toBe(configDir);
    expect(process.env['AXE_RUNTIME_DIR']).toBeUndefined();
  });

  it('reads AXE_RUNTIME_DIR from <new AXE_HOME>/.env after discovery via ~/.qwen/.env', () => {
    const configDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'qwen-bootstrap-cfg-')),
    );
    const runtimeDir = path.resolve('/tmp/from-discovered-runtime');
    fs.mkdirSync(path.join(home.tempHome, '.qwen'), { recursive: true });
    fs.writeFileSync(
      path.join(home.tempHome, '.qwen', '.env'),
      `AXE_HOME=${configDir}\n`,
    );
    fs.writeFileSync(
      path.join(configDir, '.env'),
      `AXE_RUNTIME_DIR=${runtimeDir}\n`,
    );
    try {
      expect(getRuntimeBaseDir()).toBe(runtimeDir);
      expect(process.env['AXE_HOME']).toBe(configDir);
      expect(process.env['AXE_RUNTIME_DIR']).toBe(runtimeDir);
    } finally {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });
});
