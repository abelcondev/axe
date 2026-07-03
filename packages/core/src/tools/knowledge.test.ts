/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { KnowledgeTool } from './knowledge.js';
import { KnowledgeService } from '../services/knowledge/knowledgeService.js';
import type { Config } from '../config/config.js';
import { partListUnionToString } from '../core/geminiRequest.js';

const abortSignal = new AbortController().signal;

function makeConfig(service: KnowledgeService | null): Config {
  return {
    getKnowledgeService: () => service,
  } as unknown as Config;
}

describe('KnowledgeTool', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'axe-ktool-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  async function serviceWithBundle(): Promise<KnowledgeService> {
    const file = path.join(tmpRoot, 'sdd', 'decisions', '001-x.md');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      `---
type: Decision
title: Use PostgreSQL
status: approved
---
# Decision
Use PostgreSQL for storage.
`,
      'utf8',
    );
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot);
    return svc;
  }

  it('rejects an empty query at validation time', () => {
    const tool = new KnowledgeTool(makeConfig(null));
    expect(() => tool.build({ query: '   ' })).toThrow(/query/);
  });

  it('rejects an invalid type', () => {
    const tool = new KnowledgeTool(makeConfig(null));
    expect(() =>
      // @ts-expect-error deliberately invalid type value
      tool.build({ query: 'x', type: 'Bogus' }),
    ).toThrow(/type/);
  });

  it('reports when no SDD knowledge base exists', async () => {
    const svc = new KnowledgeService();
    await svc.initialize(tmpRoot); // no sdd/ present
    const tool = new KnowledgeTool(makeConfig(svc));
    const result = await tool.build({ query: 'anything' }).execute(abortSignal);
    expect(partListUnionToString(result.llmContent)).toContain('/sdd-setup');
  });

  it('returns matches from the knowledge base', async () => {
    const svc = await serviceWithBundle();
    const tool = new KnowledgeTool(makeConfig(svc));
    const result = await tool
      .build({ query: 'postgresql' })
      .execute(abortSignal);
    const text = partListUnionToString(result.llmContent);
    expect(text).toContain('match');
    expect(text.toLowerCase()).toContain('postgresql');
    expect(text).toContain('decisions');
  });

  it('reports a clean miss for a query with no matches', async () => {
    const svc = await serviceWithBundle();
    const tool = new KnowledgeTool(makeConfig(svc));
    const result = await tool
      .build({ query: 'nonexistentterm' })
      .execute(abortSignal);
    expect(partListUnionToString(result.llmContent)).toContain('No matches');
  });
});
