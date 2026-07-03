/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { KnowledgeService } from './knowledgeService.js';

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

describe('KnowledgeService', () => {
  let tmpRoot: string;
  let sddRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-sdd-'));
    sddRoot = path.join(tmpRoot, 'sdd');
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function scaffold(): Promise<void> {
    await writeFile(path.join(sddRoot, 'index.md'), '# Index\nnot a concept\n');
    await writeFile(path.join(sddRoot, 'log.md'), '# Log\n');
    await writeFile(
      path.join(sddRoot, 'decisions', '001-use-postgres.md'),
      `---
type: Decision
title: Use PostgreSQL
description: Relational store for the app
status: approved
timestamp: 2026-01-01T00:00:00Z
---
# Decision
We will use PostgreSQL for durable storage.
`,
    );
    await writeFile(
      path.join(sddRoot, 'tasks', 'add-auth.md'),
      `---
type: Task
title: Add authentication
description: Email + password login
status: in-progress
---
# Acceptance criteria
Given a registered user
When they submit valid credentials
Then they are logged in
`,
    );
    // Template files are skipped (leading underscore).
    await writeFile(
      path.join(sddRoot, 'decisions', '_template.md'),
      `---
type: Decision
title: template
---
`,
    );
  }

  it('is ready but empty when there is no sdd/ directory', async () => {
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    expect(svc.isReady()).toBe(true);
    expect(svc.hasKnowledge()).toBe(false);
    expect(svc.getSddRoot()).toBeNull();
    expect(svc.getSummary()).toBe('');
  });

  it('finds sdd/ by walking up from a nested cwd', async () => {
    await scaffold();
    const nested = path.join(tmpRoot, 'packages', 'app', 'src');
    await fs.mkdir(nested, { recursive: true });
    const svc = new KnowledgeService();
    await svc.initialize(nested);
    expect(svc.getSddRoot()).toBe(sddRoot);
    expect(svc.hasKnowledge()).toBe(true);
  });

  it('parses concept frontmatter, skipping index/log/template files', async () => {
    await scaffold();
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    const summary = svc.getSummary();
    expect(summary).toContain('### Decisions');
    expect(summary).toContain('Use PostgreSQL');
    expect(summary).toContain('_(status: approved)_');
    expect(summary).toContain('### Tasks');
    expect(summary).toContain('Add authentication');
    // index.md / log.md / _template.md must not appear as concepts.
    expect(summary).not.toContain('template');
    expect(summary).not.toContain('not a concept');
  });

  it('searches line-by-line and returns file + line + snippet', async () => {
    await scaffold();
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    const results = await svc.search('postgresql');
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) =>
      r.snippet.toLowerCase().includes('postgresql'),
    );
    expect(hit).toBeDefined();
    expect(hit!.file).toContain('decisions');
    expect(hit!.line).toBeGreaterThan(0);
  });

  it('restricts search to a concept type when given', async () => {
    await scaffold();
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    // "credentials" appears only in the Task file.
    const asTask = await svc.search('credentials', 'Task');
    expect(asTask.length).toBeGreaterThan(0);
    const asDecision = await svc.search('credentials', 'Decision');
    expect(asDecision.length).toBe(0);
  });

  it('returns no results for an empty query', async () => {
    await scaffold();
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    expect(await svc.search('   ')).toEqual([]);
  });

  it('is case-insensitive in search', async () => {
    await scaffold();
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    const lower = await svc.search('postgresql');
    const upper = await svc.search('POSTGRESQL');
    expect(upper.length).toBe(lower.length);
  });
});
