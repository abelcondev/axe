# Quality test gate — built-in Stop hook that runs the project's tests

## Problem

The SDD loop's steps 8 (Implement TDD) and 9 (Verify) are prompt-level
instructions: nothing in the runtime verifies that tests actually ran and
passed before the agent declares a turn finished. Compliance depends entirely
on the model.

## Design

A deterministic gate built on the existing session hook machinery (same
pattern as the `/goal` Stop hook — `HookSystem.addFunctionHook`).

**Activation**: opt-in via a new `quality.testCommand` setting (string, e.g.
`"bun run test"`). No setting → no hooks registered, zero behavior change.
Opt-in is deliberate: auto-detecting `package.json` scripts would silently
start running arbitrary test suites at the end of every coding turn for every
existing project.

**Registration**: `registerTestGateHooks(config)` called from
`Config.initialize()` right after the hook system is created. Registers two
session function hooks:

1. `PostToolUse` matcher `edit|write_file` — sets a `codeChangedSinceGreen`
   flag. Purely in-memory; conversation-only turns never trigger a test run.
2. `Stop` matcher `*` — if the flag is set, runs `quality.testCommand` via
   `ShellExecutionService` in the target dir:
   - exit 0 → clears the flag, turn ends normally.
   - non-zero exit → returns `{ decision: 'block', reason }` with the tail of
     the test output (last 4000 chars). The client injects it as
     "Stop hook feedback" and the model keeps fixing. The flag stays set so
     the suite re-runs at the next Stop. The existing `stopHookBlockingCap`
     (default 8) is the runaway valve.
   - spawn failure (exitCode null + error) → non-blocking `systemMessage`
     warning; a typo'd command must not trap the session.
   - aborted → no output.

**Known trade-off**: a pre-existing red suite blocks the turn even if the
failures are unrelated to the change. Accepted — that is what a quality gate
is for; the cap bounds the worst case.

## Files

- `packages/core/src/quality/test-gate-hook.ts` — gate logic + registration.
- `packages/core/src/config/config.ts` — `qualityTestCommand` param/getter,
  registration call in `initialize()`.
- `packages/cli/src/config/settingsSchema.ts` — `quality.testCommand`.
- `packages/cli/src/config/config.ts` — settings → ConfigParams bridge.
- SDD harness step 9 (`prompts.ts`) — instruct recording verification
  evidence in the task file when marking it done.
