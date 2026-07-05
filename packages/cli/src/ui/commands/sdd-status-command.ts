/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';

interface CheckTarget {
  /** Path relative to the project root. */
  rel: string;
  /** true if this is expected to be a directory. */
  dir?: boolean;
  /** Optional note shown when missing. */
  hint?: string;
}

const CORE_TARGETS: CheckTarget[] = [
  { rel: 'AGENTS.md', hint: 'human-maintained project guide' },
  { rel: 'sdd', dir: true },
  { rel: path.join('sdd', 'index.md') },
  { rel: path.join('sdd', 'log.md') },
  { rel: path.join('sdd', 'proposal.md') },
  { rel: path.join('sdd', 'decisions'), dir: true },
  { rel: path.join('sdd', 'tasks'), dir: true },
];

function countMarkdown(dir: string): number {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_')).length;
  } catch {
    return 0;
  }
}

export const sddStatusCommand: SlashCommand = {
  name: 'sdd-status',
  get description() {
    return 'Report the state of the SDD knowledge base (sdd/) and AGENTS.md.';
  },
  kind: CommandKind.BUILT_IN,
  supportedModes: ['interactive', 'non_interactive', 'acp'] as const,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      };
    }

    const targetDir = config.getTargetDir();
    const lines: string[] = [];
    let missing = 0;

    for (const target of CORE_TARGETS) {
      const full = path.join(targetDir, target.rel);
      let ok = false;
      try {
        const stat = fs.statSync(full);
        ok = target.dir ? stat.isDirectory() : stat.isFile();
      } catch {
        ok = false;
      }
      if (!ok) {
        missing++;
      }
      const mark = ok ? '✓' : '✗';
      const hint = !ok && target.hint ? `  (${target.hint})` : '';
      lines.push(`  ${mark} ${target.rel}${hint}`);
    }

    // Concept counts when the bundle exists.
    const decisionsDir = path.join(targetDir, 'sdd', 'decisions');
    const tasksDir = path.join(targetDir, 'sdd', 'tasks');
    if (fs.existsSync(decisionsDir) || fs.existsSync(tasksDir)) {
      lines.push('');
      lines.push(`  decisions: ${countMarkdown(decisionsDir)}`);
      lines.push(`  tasks: ${countMarkdown(tasksDir)}`);
    }

    lines.push('');
    if (missing === 0) {
      lines.push('SDD knowledge base is complete.');
    } else {
      lines.push(
        `${missing} core item(s) missing. Run \`/sdd-setup\` to scaffold the bundle.`,
      );
    }

    return {
      type: 'message',
      messageType: missing === 0 ? 'info' : 'warning',
      content: `SDD status (${targetDir}):\n${lines.join('\n')}`,
    };
  },
};
