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

const INDEX_MD = `# Knowledge Index

This is the Spec-Driven Development (SDD) knowledge base for this project, in
Open Knowledge Format (OKF). It is read first at the start of every session.

- \`proposal.md\` — the current, in-review proposal (transient; cleared on approval).
- \`decisions/\` — approved, numbered architectural decisions (historical).
- \`tasks/\` — units of work with Gherkin acceptance criteria.
- \`log.md\` — append-only history of what happened and when.

Everything here is written in English regardless of conversation language.
`;

const LOG_MD = `# Log

Append-only history of decisions and milestones. Newest last.
`;

const PROPOSAL_MD = `---
type: Proposal
title: (none)
description: No active proposal.
status: draft
timestamp: ${new Date().toISOString()}
---

# Proposal

_No active proposal. When the user wants to build something, write the proposed
approach here, then archive it to \`decisions/\` once approved._
`;

const DECISION_TEMPLATE = `---
type: Decision
title: Short decision title
description: One-line summary of the decision.
resource: (optional link or path)
tags: []
status: approved
timestamp: ${new Date().toISOString()}
supersedes: []
---

# Decision

State the decision clearly.

# Context

Why this decision was made; the forces and constraints in play.

# Citations

Sources, links, or files that grounded the decision.
`;

const TASK_TEMPLATE = `---
type: Task
title: Short task title
description: One-line summary of the task.
tags: []
status: pending
timestamp: ${new Date().toISOString()}
---

# Acceptance criteria

\`\`\`gherkin
Scenario: <describe the behavior>
  Given <precondition>
  When <action>
  Then <expected outcome>
\`\`\`

# Dependencies

List any tasks or decisions this depends on.
`;

interface ScaffoldFile {
  /** Path relative to the sdd/ root. */
  rel: string;
  content: string;
}

const SCAFFOLD: ScaffoldFile[] = [
  { rel: 'index.md', content: INDEX_MD },
  { rel: 'log.md', content: LOG_MD },
  { rel: 'proposal.md', content: PROPOSAL_MD },
  { rel: path.join('decisions', '_template.md'), content: DECISION_TEMPLATE },
  { rel: path.join('tasks', '_template.md'), content: TASK_TEMPLATE },
];

export const sddSetupCommand: SlashCommand = {
  name: 'sdd-setup',
  get description() {
    return 'Scaffold the SDD (Spec-Driven Development) knowledge base under sdd/.';
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
    const sddRoot = path.join(targetDir, 'sdd');

    const created: string[] = [];
    const skipped: string[] = [];

    try {
      for (const file of SCAFFOLD) {
        const full = path.join(sddRoot, file.rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        if (fs.existsSync(full)) {
          skipped.push(path.join('sdd', file.rel));
          continue;
        }
        fs.writeFileSync(full, file.content, 'utf8');
        created.push(path.join('sdd', file.rel));
      }
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to scaffold SDD bundle: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    const lines: string[] = [];
    if (created.length > 0) {
      lines.push('Created:');
      for (const f of created) {
        lines.push(`  + ${f}`);
      }
    }
    if (skipped.length > 0) {
      lines.push('Already present (left untouched):');
      for (const f of skipped) {
        lines.push(`  = ${f}`);
      }
    }
    lines.push('');
    lines.push(
      'SDD knowledge base ready. Restart the session (or it will be picked up on the next start) so the knowledge index loads into context.',
    );

    return {
      type: 'message',
      messageType: 'info',
      content: lines.join('\n'),
    };
  },
};
