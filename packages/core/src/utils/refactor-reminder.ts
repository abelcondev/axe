/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quality gate: nudge the model to evaluate a refactor when a file it just
 * wrote grows past this many lines. Deterministic (fired by tool code, not by
 * instructions), but the actual refactor decision stays with the model — it
 * must report its recommendation to the user rather than act unilaterally.
 */
export const REFACTOR_LINE_THRESHOLD = 300;

function countLines(content: string): number {
  return content.split('\n').length;
}

/**
 * Returns a `<system-reminder>` string when a write leaves `newContent` above
 * the line threshold AND the file grew (or is new). Returns `undefined`
 * otherwise, so shrinking edits and small edits to an already-large file that
 * don't add lines never re-nag.
 */
export function buildRefactorReminder(
  filePath: string,
  newContent: string,
  previousContent?: string | null,
): string | undefined {
  const newLines = countLines(newContent);
  if (newLines <= REFACTOR_LINE_THRESHOLD) {
    return undefined;
  }
  if (previousContent != null && countLines(previousContent) >= newLines) {
    return undefined;
  }
  return (
    `<system-reminder>The file ${filePath} now has ${newLines} lines, ` +
    `exceeding the ${REFACTOR_LINE_THRESHOLD}-line quality threshold. Evaluate ` +
    `whether it warrants refactoring or splitting into smaller, cohesive ` +
    `modules. If it does, tell the user your recommendation with a brief ` +
    `justification and wait for confirmation before refactoring. If the length ` +
    `is justified (e.g. generated code, cohesive logic, tests, or data), say so ` +
    `in one line and continue.</system-reminder>`
  );
}
