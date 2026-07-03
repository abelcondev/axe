/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import React from 'react';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Renders the reference index status panel: one row per active dependency with
 * its indexing state, file count, size, and source.
 */
function renderStatus(context: CommandContext): SlashCommandActionReturn {
  const { config } = context.services;
  const service = config?.getReferenceService();
  if (!service) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Reference index is not available.',
    };
  }

  const active = service.getActivePackages();
  if (active.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content:
        'No production dependencies detected — nothing to index. References index `dependencies` and `peerDependencies`.',
    };
  }

  const manifest = service.getManifest();
  const lines: string[] = [];
  let indexed = 0;
  let totalBytes = 0;

  for (const pkg of active) {
    const entry = manifest[`${pkg.name}@${pkg.version}`];
    let mark: string;
    let detail: string;
    if (entry?.status === 'indexed') {
      indexed++;
      totalBytes += entry.size;
      mark = '✓';
      detail = `${entry.fileCount} files · ${mb(entry.size)} · ${entry.source}`;
    } else if (entry?.status === 'error') {
      mark = '✗';
      detail = entry.error ?? 'error';
    } else {
      mark = '○';
      detail = 'pending';
    }
    lines.push(`  ${mark} ${pkg.name}@${pkg.version} — ${detail}`);
  }

  lines.push('');
  lines.push(
    `${indexed}/${active.length} indexed · ${mb(totalBytes)} · cache: ~/.axe/references`,
  );
  lines.push('');
  lines.push('Use `/references refresh [pkg]` to (re)index, `/references clear [pkg]` to remove.');

  return {
    type: 'message',
    messageType: 'info',
    content: `Dependency source references:\n${lines.join('\n')}`,
  };
}

const refreshCommand: SlashCommand = {
  name: 'refresh',
  get description() {
    return 'Download and (re)index dependency source. Optionally pass a package name.';
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive'] as const,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    const service = config?.getReferenceService();
    if (!service) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Reference index is not available.',
      };
    }

    const pkgArg = args.trim();
    const targets = pkgArg
      ? service.getActivePackages().filter((p) => p.name === pkgArg || p.installName === pkgArg)
      : service.getActivePackages();

    if (targets.length === 0) {
      return {
        type: 'message',
        messageType: 'error',
        content: pkgArg
          ? `"${pkgArg}" is not a production dependency of this project.`
          : 'No production dependencies to index.',
      };
    }

    // Downloading source is a network operation — confirm first.
    if (!context.overwriteConfirmed) {
      const label = pkgArg
        ? `${targets[0].name}@${targets[0].version}`
        : `${targets.length} package(s)`;
      return {
        type: 'confirm_action',
        prompt: React.createElement(
          Text,
          null,
          `Fetch and index source for ${label}? This clones/downloads from the network into ~/.axe/references.`,
        ),
        originalInvocation: {
          raw: context.invocation?.raw || '/references refresh',
        },
      };
    }

    // Confirmed: index each target, forcing a re-fetch.
    let ok = 0;
    let failed = 0;
    for (const pkg of targets) {
      const entry = await service.ensureIndexed(pkg.installName, {
        force: true,
      });
      if (entry?.status === 'indexed') {
        ok++;
      } else {
        failed++;
      }
    }
    return {
      type: 'message',
      messageType: failed === 0 ? 'info' : 'warning',
      content: `Indexed ${ok} package(s)${failed ? `, ${failed} failed` : ''}. Run \`/references\` for details.`,
    };
  },
};

const clearCommand: SlashCommand = {
  name: 'clear',
  get description() {
    return 'Remove indexed source from the cache. Optionally pass a package name.';
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive'] as const,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    const service = config?.getReferenceService();
    if (!service) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Reference index is not available.',
      };
    }
    const pkgArg = args.trim() || undefined;
    const removed = await service.clear(pkgArg);
    return {
      type: 'message',
      messageType: 'info',
      content: pkgArg
        ? `Cleared ${removed} cached reference(s) for "${pkgArg}".`
        : `Cleared ${removed} cached reference(s).`,
    };
  },
};

export const referencesCommand: SlashCommand = {
  name: 'references',
  get description() {
    return "Show and manage the indexed source of this project's dependencies.";
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => renderStatus(context),
  subCommands: [refreshCommand, clearCommand],
};
