/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from './doc-chunks.js';

describe('chunkMarkdown', () => {
  it('splits on headings and records the heading line number', () => {
    const md = [
      'Intro paragraph long enough to keep around.',
      '',
      '## Auth',
      'Use subscribeAuth to listen for auth state changes.',
      '',
      '## Queries',
      'Use useQuery to subscribe to data.',
    ].join('\n');
    const chunks = chunkMarkdown('README.md', md);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].line).toBe(1);
    expect(chunks[1]).toMatchObject({ file: 'README.md', line: 3 });
    expect(chunks[1].text).toBe(
      '## Auth\nUse subscribeAuth to listen for auth state changes.',
    );
    expect(chunks[2].line).toBe(6);
  });

  it('does not treat # inside code fences as a heading', () => {
    const md = [
      '## Setup',
      '```bash',
      '# comment inside a fence, not a heading',
      'npm install',
      '```',
      'After the fence.',
    ].join('\n');
    const chunks = chunkMarkdown('README.md', md);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toContain('After the fence.');
  });

  it('drops chunks below the minimum size', () => {
    const chunks = chunkMarkdown('README.md', '## Tiny\nok');
    expect(chunks).toHaveLength(0);
  });

  it('splits oversized sections on paragraphs, repeating the heading', () => {
    const paragraph = 'x'.repeat(700);
    const md = `## Big\n${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkMarkdown('docs/big.md', md);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('## Big\n')).toBe(true);
      expect(chunk.text.length).toBeLessThanOrEqual(1500);
      expect(chunk.line).toBe(1);
    }
  });
});
