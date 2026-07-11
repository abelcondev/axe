/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type {
  FunctionHookContext,
  HookInput,
  HookOutput,
} from '../hooks/types.js';
import { HookEventName } from '../hooks/types.js';
import { ShellExecutionService } from '../services/shellExecutionService.js';
import { ToolNames } from '../tools/tool-names.js';

const TEST_GATE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_CHARS = 4000;

/**
 * Runs the configured test command and translates the result into a Stop
 * hook output: green → undefined (turn ends normally), red → a blocking
 * decision carrying the tail of the test output so the model fixes the
 * failures instead of finishing, spawn failure → a non-blocking warning so
 * a mistyped command cannot trap the session.
 */
export async function runTestGate(
  testCommand: string,
  cwd: string,
  signal: AbortSignal,
): Promise<HookOutput | undefined> {
  const handle = await ShellExecutionService.execute(
    testCommand,
    cwd,
    () => {},
    signal,
    false,
    {},
  );
  const result = await handle.result;

  if (result.aborted) {
    return undefined;
  }
  if (result.error && result.exitCode === null) {
    return {
      systemMessage: `Test gate: could not run \`${testCommand}\`: ${result.error.message}`,
    };
  }
  if (result.exitCode === 0) {
    return undefined;
  }

  const output = result.output.trim();
  const tail =
    output.length > MAX_OUTPUT_CHARS
      ? `…\n${output.slice(-MAX_OUTPUT_CHARS)}`
      : output;
  return {
    decision: 'block',
    reason:
      `Test gate: \`${testCommand}\` failed (exit code ${result.exitCode}). ` +
      `Fix the failing tests before finishing — do not mark any task as done while the suite is red.\n\n${tail}`,
  };
}

/**
 * Registers the built-in quality test gate for the session when
 * `quality.testCommand` is configured: a PostToolUse hook tracks whether any
 * file-mutating tool ran, and a Stop hook runs the test command before the
 * agent may end a turn that changed code. Conversation-only turns never run
 * tests; a green run resets the tracker until the next code change.
 */
export function registerTestGateHooks(config: Config): void {
  const testCommand = config.getQualityTestCommand();
  const system = config.getHookSystem();
  if (!testCommand || !system) {
    return;
  }

  const sessionId = config.getSessionId();
  let codeChangedSinceGreen = false;

  system.addFunctionHook(
    sessionId,
    HookEventName.PostToolUse,
    `${ToolNames.EDIT}|${ToolNames.WRITE_FILE}`,
    async () => {
      codeChangedSinceGreen = true;
      return undefined;
    },
    'Test gate change tracker failed',
    { name: 'test-gate-tracker' },
  );

  system.addFunctionHook(
    sessionId,
    HookEventName.Stop,
    '*',
    async (_input: HookInput, context?: FunctionHookContext) => {
      if (!codeChangedSinceGreen) {
        return undefined;
      }
      const signal = context?.signal ?? new AbortController().signal;
      const output = await runTestGate(
        testCommand,
        config.getTargetDir(),
        signal,
      );
      if (!output?.decision) {
        codeChangedSinceGreen = false;
      }
      return output;
    },
    'Test gate failed to run the test command',
    {
      name: 'test-gate',
      description: `Runs \`${testCommand}\` before ending a turn that changed code`,
      statusMessage: `Running tests (${testCommand})…`,
      timeout: TEST_GATE_TIMEOUT_MS,
    },
  );
}
