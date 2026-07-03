import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { getGlobalQwenDir, resolvePath } from './paths.js';

describe('channels/base paths – getGlobalQwenDir', () => {
  const originalEnv = process.env['AXE_HOME'];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['AXE_HOME'] = originalEnv;
    } else {
      delete process.env['AXE_HOME'];
    }
  });

  it('defaults to ~/.qwen when AXE_HOME is not set', () => {
    delete process.env['AXE_HOME'];
    expect(getGlobalQwenDir()).toBe(path.join(os.homedir(), '.qwen'));
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
    expect(getGlobalQwenDir()).toBe(path.join(os.homedir(), 'custom-qwen'));
  });

  it('expands Windows-style tilde (~\\x) in AXE_HOME', () => {
    process.env['AXE_HOME'] = '~\\custom-qwen';
    expect(getGlobalQwenDir()).toBe(path.join(os.homedir(), 'custom-qwen'));
  });

  it('treats bare tilde (~) as home directory', () => {
    process.env['AXE_HOME'] = '~';
    expect(getGlobalQwenDir()).toBe(path.normalize(os.homedir()));
  });
});

describe('channels/base paths – resolvePath', () => {
  it('returns absolute paths unchanged', () => {
    const abs = path.resolve('/tmp/x');
    expect(resolvePath(abs)).toBe(abs);
  });

  it('expands bare tilde (~) to home directory', () => {
    expect(resolvePath('~')).toBe(path.normalize(os.homedir()));
  });

  it('expands POSIX-style tilde (~/x)', () => {
    expect(resolvePath('~/xomo')).toBe(path.join(os.homedir(), 'xomo'));
  });

  it('expands Windows-style tilde (~\\x)', () => {
    expect(resolvePath('~\\xomo')).toBe(path.join(os.homedir(), 'xomo'));
  });

  it('resolves relative paths against process.cwd', () => {
    expect(resolvePath('relative/dir')).toBe(path.resolve('relative/dir'));
  });
});
