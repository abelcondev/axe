/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  REFACTOR_LINE_THRESHOLD,
  buildRefactorReminder,
} from './refactor-reminder.js';

const lines = (n: number): string => Array.from({ length: n }, () => 'x').join('\n');

describe('buildRefactorReminder', () => {
  it('returns undefined when the file is at or below the threshold', () => {
    expect(
      buildRefactorReminder('a.ts', lines(REFACTOR_LINE_THRESHOLD)),
    ).toBeUndefined();
  });

  it('fires for a new file above the threshold', () => {
    const reminder = buildRefactorReminder('a.ts', lines(REFACTOR_LINE_THRESHOLD + 1));
    expect(reminder).toContain('<system-reminder>');
    expect(reminder).toContain(`${REFACTOR_LINE_THRESHOLD + 1} lines`);
    expect(reminder).toContain('a.ts');
  });

  it('fires when an existing file grows past the threshold', () => {
    const reminder = buildRefactorReminder(
      'a.ts',
      lines(REFACTOR_LINE_THRESHOLD + 50),
      lines(REFACTOR_LINE_THRESHOLD + 10),
    );
    expect(reminder).toContain('<system-reminder>');
  });

  it('stays silent when an oversized file does not grow', () => {
    expect(
      buildRefactorReminder(
        'a.ts',
        lines(REFACTOR_LINE_THRESHOLD + 10),
        lines(REFACTOR_LINE_THRESHOLD + 10),
      ),
    ).toBeUndefined();
  });

  it('stays silent when an oversized file shrinks', () => {
    expect(
      buildRefactorReminder(
        'a.ts',
        lines(REFACTOR_LINE_THRESHOLD + 5),
        lines(REFACTOR_LINE_THRESHOLD + 40),
      ),
    ).toBeUndefined();
  });
});
