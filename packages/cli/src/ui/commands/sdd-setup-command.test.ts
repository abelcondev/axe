/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getTestingStatusLine } from './sdd-setup-command.js';

describe('getTestingStatusLine', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-setup-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writePkg = (scripts?: Record<string, string>) => {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', ...(scripts ? { scripts } : {}) }),
    );
  };

  it('points to post-scaffold setup when there is no package.json', () => {
    expect(getTestingStatusLine(dir)).toContain('no package.json yet');
  });

  it('confirms an existing test script', () => {
    writePkg({ test: 'vitest run' });
    expect(getTestingStatusLine(dir)).toContain('"test" script found');
  });

  it('names the package manager detected from the lockfile', () => {
    writePkg({ test: 'vitest run' });
    fs.writeFileSync(path.join(dir, 'bun.lock'), '');
    expect(getTestingStatusLine(dir)).toContain('`bun run test`');
  });

  it('instructs setting up the runner when the test script is missing', () => {
    writePkg();
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    const line = getTestingStatusLine(dir);
    expect(line).toContain('no "test" script');
    expect(line).toContain('pnpm (detected from lockfile)');
  });

  it('never assumes npm when there is no lockfile', () => {
    writePkg();
    const line = getTestingStatusLine(dir);
    expect(line).toContain('never assume npm');
  });

  it.each([
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
  ])('detects %s as %s', (lockfile, pm) => {
    writePkg();
    fs.writeFileSync(path.join(dir, lockfile), '');
    expect(getTestingStatusLine(dir)).toContain(
      `${pm} (detected from lockfile)`,
    );
  });
});
