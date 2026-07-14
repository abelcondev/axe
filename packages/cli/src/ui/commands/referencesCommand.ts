/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import { Text } from 'ink';
import React from 'react';
import type { ReferenceEntry } from '@axe/core';
import {
  EMBEDDING_MODEL,
  clearStoredHfToken,
  getSemanticSearchStatus,
  getStoredHfToken,
  isValidHfToken,
  maskToken,
  provisionSemanticSearch,
  setStoredHfToken,
} from '@axe/core';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusRow(entry: ReferenceEntry | undefined): {
  mark: string;
  detail: string;
} {
  if (entry?.status === 'indexed') {
    return {
      mark: '✓',
      detail: `${entry.fileCount} files · ${mb(entry.size)} · ${entry.source}`,
    };
  }
  if (entry?.status === 'error') {
    return { mark: '✗', detail: entry.error ?? 'error' };
  }
  return { mark: '○', detail: 'pending' };
}

/**
 * Renders the reference index status panel: one row per active dependency with
 * its indexing state, file count, size, and source.
 */
async function renderStatus(
  context: CommandContext,
): Promise<SlashCommandActionReturn> {
  const { config } = context.services;
  const service = config?.getReferenceService();
  if (!service) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Reference index is not available.',
    };
  }

  // The startup scan is stale when the project was scaffolded or deps were
  // installed mid-session — re-read package.json so the panel never lies.
  await service.rescan();
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
  let total = active.length;
  let totalBytes = 0;

  for (const pkg of active) {
    const entry = manifest[`${pkg.name}@${pkg.version}`];
    if (entry?.status === 'indexed') {
      indexed++;
      totalBytes += entry.size;
    }
    const { mark, detail } = statusRow(entry);
    lines.push(`  ${mark} ${pkg.name}@${pkg.version} — ${detail}`);
  }

  // Transitive deps indexed on demand (e.g. via `/references refresh <pkg>`
  // or a Reference tool search) live only in the manifest. The cache is
  // shared across projects, so list only entries that resolve to this
  // project's node_modules at the same version.
  const activeKeys = new Set(active.map((p) => `${p.name}@${p.version}`));
  for (const [key, entry] of Object.entries(manifest)) {
    if (activeKeys.has(key)) {
      continue;
    }
    const installed = await service.resolveInstalled(entry.package);
    if (!installed || installed.version !== entry.version) {
      continue;
    }
    total++;
    if (entry.status === 'indexed') {
      indexed++;
      totalBytes += entry.size;
    }
    const { mark, detail } = statusRow(entry);
    lines.push(`  ${mark} ${key} — ${detail} · on-demand`);
  }

  lines.push('');
  lines.push(
    `${indexed}/${total} indexed · ${mb(totalBytes)} · cache: ~/.axe/references`,
  );

  const semantic = await getSemanticSearchStatus(EMBEDDING_MODEL);
  lines.push('');
  lines.push('Semantic search');
  lines.push(
    `  runtime: ${semantic.runtime.installed ? '✓ installed' : '○ not installed'}   model: ${
      semantic.model.downloaded ? '✓ downloaded' : '○ not downloaded'
    }   token: ${semantic.token.set ? `✓ ${semantic.token.masked}` : '○ not set'}`,
  );
  if (semantic.indexes.count > 0) {
    lines.push(
      `  semantic indexes: ${semantic.indexes.count} package(s) · ${mb(semantic.indexes.bytes)}`,
    );
  }
  if (!semantic.runtime.installed || !semantic.model.downloaded) {
    lines.push('  Run `/references setup [hf_token]` to provision.');
  }

  lines.push('');
  lines.push(
    'Use `/references refresh [pkg]` to (re)index, `/references clear [pkg]` to remove.',
  );

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

    // Pick up dependencies installed after session start (mid-session
    // scaffold / npm install) before resolving targets.
    await service.rescan();
    const pkgArg = args.trim();
    let targets = pkgArg
      ? service
          .getActivePackages()
          .filter((p) => p.name === pkgArg || p.installName === pkgArg)
      : service.getActivePackages();

    // Not a direct dependency: fall back to the node_modules lookup so
    // transitive deps (e.g. `@instantdb/core` behind `@instantdb/svelte`)
    // can be pre-indexed by name, matching the Reference tool's behavior.
    if (pkgArg && targets.length === 0) {
      const transitive = await service.resolveInstalled(pkgArg);
      if (transitive) {
        targets = [transitive];
      }
    }

    if (targets.length === 0) {
      return {
        type: 'message',
        messageType: 'error',
        content: pkgArg
          ? `"${pkgArg}" is not installed in this project (checked package.json dependencies and node_modules).`
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

    // Confirmed: index in the background. Cloning several monorepos can take
    // minutes (each fetch has its own network timeout) and slash-command
    // actions block the composer while they run — awaiting here left the UI
    // without an input box until every clone finished.
    const { addItem } = context.ui;
    void (async () => {
      let ok = 0;
      let failed = 0;
      for (const pkg of targets) {
        try {
          const entry = await service.ensureIndexed(pkg.installName, {
            force: true,
          });
          if (entry?.status === 'indexed') {
            ok++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }
      addItem(
        {
          type: failed === 0 ? 'info' : 'warning',
          text: `References: indexed ${ok} package(s)${failed ? `, ${failed} failed` : ''}. Run \`/references\` for details.`,
        },
        Date.now(),
      );
    })();

    return {
      type: 'message',
      messageType: 'info',
      content: `Indexing ${targets.length} package(s) in the background… Run \`/references\` to check progress.`,
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

const tokenCommand: SlashCommand = {
  name: 'token',
  get description() {
    return 'Show, set, or clear the Hugging Face token used for embedding model downloads.';
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const arg = args.trim();
    if (!arg) {
      const envToken = process.env['HF_TOKEN']?.trim();
      const stored = await getStoredHfToken();
      const state = envToken
        ? `set via HF_TOKEN env var (${maskToken(envToken)})`
        : stored
          ? `set (${maskToken(stored)}, stored in ~/.axe/hf-token)`
          : 'not set. Get a free read token at huggingface.co/settings/tokens, then run `/references token hf_…`.';
      return {
        type: 'message',
        messageType: 'info',
        content: `Hugging Face token: ${state}`,
      };
    }
    if (arg === 'clear') {
      const removed = await clearStoredHfToken();
      return {
        type: 'message',
        messageType: 'info',
        content: removed
          ? 'Hugging Face token removed.'
          : 'No stored token to remove.',
      };
    }
    if (!isValidHfToken(arg)) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Invalid token — expected the `hf_…` format.',
      };
    }
    await setStoredHfToken(arg);
    return {
      type: 'message',
      messageType: 'info',
      content: `Hugging Face token saved (${maskToken(arg)}).`,
    };
  },
};

const STEP_LABELS: Record<string, string> = {
  token: 'token',
  runtime: 'embedding runtime',
  model: 'model',
  verify: 'verification',
};

const setupCommand: SlashCommand = {
  name: 'setup',
  get description() {
    return 'Provision semantic search: HF token, embedding runtime, and model.';
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive'] as const,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const token = args.trim() || undefined;
    if (token && !isValidHfToken(token)) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Invalid token — expected the `hf_…` format.',
      };
    }

    // Installing the runtime and downloading the model are network
    // operations — confirm first, like refresh does.
    if (!context.overwriteConfirmed) {
      return {
        type: 'confirm_action',
        prompt: React.createElement(
          Text,
          null,
          'Set up semantic search? This may install the embedding runtime (~100 MB into ~/.axe/runtime) and download the model (~34 MB into ~/.axe/models).',
        ),
        originalInvocation: {
          raw: context.invocation?.raw || '/references setup',
        },
      };
    }

    const { addItem } = context.ui;
    void (async () => {
      const steps = await provisionSemanticSearch({
        token,
        onStep: (step) => {
          addItem(
            {
              type: step.ok ? 'info' : 'error',
              text: `Semantic setup: ${step.ok ? '✓' : '✗'} ${STEP_LABELS[step.step]} — ${step.detail}`,
            },
            Date.now(),
          );
        },
      });
      const failed = steps.some((s) => !s.ok);
      addItem(
        {
          type: failed ? 'warning' : 'info',
          text: failed
            ? 'Semantic search setup did not complete. Fix the failed step above and re-run `/references setup`.'
            : 'Semantic search is ready. Reference searches now include semantically related docs and API signatures.',
        },
        Date.now(),
      );
    })();

    return {
      type: 'message',
      messageType: 'info',
      content:
        'Setting up semantic search… Each step reports here as it completes.',
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
  subCommands: [refreshCommand, clearCommand, setupCommand, tokenCommand],
};
