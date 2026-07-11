/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config/config.js';
import { HookEventName } from '../hooks/types.js';
import type { ShellExecutionResult } from '../services/shellExecutionService.js';
import { ShellExecutionService } from '../services/shellExecutionService.js';
import { registerTestGateHooks, runTestGate } from './test-gate-hook.js';

function shellResult(overrides: Partial<ShellExecutionResult>) {
  return {
    rawOutput: Buffer.from(''),
    output: '',
    exitCode: 0,
    signal: null,
    error: null,
    aborted: false,
    ...overrides,
  } as ShellExecutionResult;
}

function mockExecute(result: Partial<ShellExecutionResult>) {
  return vi.spyOn(ShellExecutionService, 'execute').mockResolvedValue({
    pid: 123,
    result: Promise.resolve(shellResult(result)),
  });
}

const signal = new AbortController().signal;

describe('runTestGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when the suite is green', async () => {
    mockExecute({ exitCode: 0 });
    expect(await runTestGate('npm test', '/proj', signal)).toBeUndefined();
  });

  it('blocks with the test output when the suite is red', async () => {
    mockExecute({ exitCode: 1, output: 'FAIL foo.test.ts\nexpected 2 got 3' });
    const out = await runTestGate('npm test', '/proj', signal);
    expect(out?.decision).toBe('block');
    expect(out?.reason).toContain('`npm test` failed (exit code 1)');
    expect(out?.reason).toContain('expected 2 got 3');
  });

  it('keeps only the tail of oversized output', async () => {
    mockExecute({ exitCode: 1, output: `${'x'.repeat(10_000)}TAIL` });
    const out = await runTestGate('npm test', '/proj', signal);
    expect(out?.reason).toContain('TAIL');
    expect(out?.reason?.length).toBeLessThan(5000);
  });

  it('warns without blocking when the command cannot be spawned', async () => {
    mockExecute({ exitCode: null, error: new Error('spawn ENOENT') });
    const out = await runTestGate('bogus-cmd', '/proj', signal);
    expect(out?.decision).toBeUndefined();
    expect(out?.systemMessage).toContain('spawn ENOENT');
  });

  it('returns undefined when the run was aborted', async () => {
    mockExecute({ aborted: true, exitCode: null });
    expect(await runTestGate('npm test', '/proj', signal)).toBeUndefined();
  });
});

describe('registerTestGateHooks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setup(testCommand: string | undefined) {
    const addFunctionHook = vi.fn().mockReturnValue('hook-id');
    const config = {
      getQualityTestCommand: () => testCommand,
      getHookSystem: () => ({ addFunctionHook }),
      getSessionId: () => 'session-1',
      getTargetDir: () => '/proj',
    } as unknown as Config;
    registerTestGateHooks(config);
    return { addFunctionHook };
  }

  it('registers nothing without quality.testCommand', () => {
    const { addFunctionHook } = setup(undefined);
    expect(addFunctionHook).not.toHaveBeenCalled();
  });

  it('registers a PostToolUse tracker and a Stop gate', () => {
    const { addFunctionHook } = setup('npm test');
    expect(addFunctionHook).toHaveBeenCalledTimes(2);
    expect(addFunctionHook.mock.calls[0][1]).toBe(HookEventName.PostToolUse);
    expect(addFunctionHook.mock.calls[0][2]).toBe('edit|write_file');
    expect(addFunctionHook.mock.calls[1][1]).toBe(HookEventName.Stop);
  });

  it('only runs tests after a file-mutating tool, and resets on green', async () => {
    const { addFunctionHook } = setup('npm test');
    const trackerCb = addFunctionHook.mock.calls[0][3];
    const stopCb = addFunctionHook.mock.calls[1][3];
    const execute = mockExecute({ exitCode: 0 });

    await stopCb({});
    expect(execute).not.toHaveBeenCalled();

    await trackerCb({});
    await stopCb({});
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      'npm test',
      '/proj',
      expect.any(Function),
      expect.any(Object),
      false,
      {},
    );

    await stopCb({});
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the gate armed while the suite is red', async () => {
    const { addFunctionHook } = setup('npm test');
    const trackerCb = addFunctionHook.mock.calls[0][3];
    const stopCb = addFunctionHook.mock.calls[1][3];
    const execute = mockExecute({ exitCode: 1, output: 'FAIL' });

    await trackerCb({});
    expect((await stopCb({}))?.decision).toBe('block');
    expect((await stopCb({}))?.decision).toBe('block');
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
