/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import type { ActivePackage, ReferenceEntry } from '@axe/core';
import { referencesCommand } from './referencesCommand.js';
import type { CommandContext, MessageActionReturn } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

function indexedEntry(name: string, version: string): ReferenceEntry {
  return {
    package: name,
    version,
    source: 'git',
    size: 1024 * 1024,
    fileCount: 10,
    status: 'indexed',
    cachePath: `/refs/${name}@${version}`,
  };
}

function makeContext(overrides: {
  active: ActivePackage[];
  manifest: Record<string, ReferenceEntry>;
  installed?: Record<string, ActivePackage>;
}): CommandContext {
  const service = {
    rescan: vi.fn().mockResolvedValue(undefined),
    getActivePackages: () => overrides.active,
    getManifest: () => overrides.manifest,
    resolveInstalled: vi
      .fn()
      .mockImplementation(async (name: string) =>
        overrides.active.find((p) => p.name === name) ??
        overrides.installed?.[name] ??
        null,
      ),
  };
  return createMockCommandContext({
    services: {
      config: {
        getReferenceService: () => service,
      },
    },
  });
}

async function run(context: CommandContext): Promise<string> {
  const result = (await referencesCommand.action!(
    context,
    '',
  )) as MessageActionReturn;
  expect(result.type).toBe('message');
  return result.content;
}

describe('referencesCommand status', () => {
  it('lists active packages with their manifest status', async () => {
    const context = makeContext({
      active: [{ name: 'foo', installName: 'foo', version: '1.0.0' }],
      manifest: { 'foo@1.0.0': indexedEntry('foo', '1.0.0') },
    });
    const content = await run(context);
    expect(content).toContain('✓ foo@1.0.0 — 10 files · 1.0 MB · git');
    expect(content).toContain('1/1 indexed');
  });

  it('lists on-demand indexed transitives installed in this project', async () => {
    const context = makeContext({
      active: [{ name: 'foo', installName: 'foo', version: '1.0.0' }],
      manifest: {
        'foo@1.0.0': indexedEntry('foo', '1.0.0'),
        '@scope/core@2.0.0': indexedEntry('@scope/core', '2.0.0'),
      },
      installed: {
        '@scope/core': {
          name: '@scope/core',
          installName: '@scope/core',
          version: '2.0.0',
          localPath: '/proj/node_modules/@scope/core',
        },
      },
    });
    const content = await run(context);
    expect(content).toContain(
      '✓ @scope/core@2.0.0 — 10 files · 1.0 MB · git · on-demand',
    );
    expect(content).toContain('2/2 indexed · 2.0 MB');
  });

  it('hides manifest entries that do not resolve in this project', async () => {
    const context = makeContext({
      active: [{ name: 'foo', installName: 'foo', version: '1.0.0' }],
      manifest: {
        'foo@1.0.0': indexedEntry('foo', '1.0.0'),
        // Another project's dependency: not installed here.
        'other@3.0.0': indexedEntry('other', '3.0.0'),
        // Stale entry for an active dep at an old version.
        'foo@0.9.0': indexedEntry('foo', '0.9.0'),
      },
    });
    const content = await run(context);
    expect(content).not.toContain('other@3.0.0');
    expect(content).not.toContain('foo@0.9.0');
    expect(content).toContain('1/1 indexed');
  });
});
