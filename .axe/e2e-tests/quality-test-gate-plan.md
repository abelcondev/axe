# E2E plan — quality test gate (Stop hook)

Status: pending manual dogfood.

## Setup

1. Scratch project with a failing suite:
   ```bash
   mkdir -p /tmp/gate-demo && cd /tmp/gate-demo && git init
   printf '{"name":"demo","scripts":{"test":"exit 1"}}' > package.json
   mkdir -p .axe && printf '{"quality":{"testCommand":"npm test"}}' > .axe/settings.json
   ```
2. Run axe (dev build) in that directory.

## Scenarios

1. **Conversation-only turn** — ask a question, no file edits.
   Expect: no test run, turn ends normally (tracker never armed).
2. **Turn with an edit, red suite** — ask axe to create/edit a file.
   Expect: "Running tests (npm test)…" status at end of turn; turn is
   blocked; model receives Stop hook feedback containing
   "Test gate: `npm test` failed (exit code 1)" and keeps working; after
   `stopHookBlockingCap` (8) consecutive blocks the turn is released with a
   warning.
3. **Red → green mid-loop** — while blocked, have the model fix the script
   (`"test":"exit 0"` counts: it edits package.json, gate re-runs).
   Expect: suite green → turn ends; next edit-free turn runs no tests.
4. **Broken command** — set `quality.testCommand` to `bogus-cmd-xyz`.
   Expect: non-blocking system message "could not run", turn NOT trapped.
5. **No setting** — remove `quality` from settings.
   Expect: zero behavior change, no hooks registered.
