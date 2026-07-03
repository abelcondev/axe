/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';
import type { Config } from '../config/config.js';
import type { KnowledgeConceptType } from '../services/knowledge/types.js';

const KNOWLEDGE_TYPES: readonly KnowledgeConceptType[] = [
  'Decision',
  'Task',
  'Proposal',
];

export interface KnowledgeToolParams {
  query: string;
  type?: KnowledgeConceptType;
}

const DESCRIPTION = `Searches this project's Spec-Driven Development (SDD) knowledge base under \`sdd/\` — the recorded Decisions, Tasks, and Proposals in Open Knowledge Format.

Use this before making architectural choices or starting work, to recall prior decisions and their rationale, in-flight tasks, and open proposals. Returns matching lines with their file and line number.

- \`query\`: text to search for (matched case-insensitively, line by line). A single symbol or identifier works best; multiple words are matched as-is.
- \`type\` (optional): restrict the search to one concept type — \`Decision\`, \`Task\`, or \`Proposal\`.`;

class KnowledgeToolInvocation extends BaseToolInvocation<
  KnowledgeToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: KnowledgeToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    const scope = this.params.type ? ` (${this.params.type})` : '';
    return `Search SDD knowledge${scope}: "${this.params.query}"`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const service = this.config.getKnowledgeService();
    if (!service || !service.getSddRoot()) {
      const msg =
        'No SDD knowledge base found. This project has no `sdd/` directory — run `/sdd-setup` to create one.';
      return { llmContent: msg, returnDisplay: msg };
    }

    const results = await service.search(this.params.query, this.params.type);
    if (results.length === 0) {
      const scope = this.params.type ? ` of type ${this.params.type}` : '';
      const msg = `No matches for "${this.params.query}"${scope} in the SDD knowledge base.`;
      return { llmContent: msg, returnDisplay: msg };
    }

    const lines = results.map((r) => `${r.file}:${r.line}: ${r.snippet}`);
    const body = lines.join('\n');
    const header = `Found ${results.length} match(es) in the SDD knowledge base:`;
    return {
      llmContent: `${header}\n${body}`,
      returnDisplay: `${header}\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }
}

export class KnowledgeTool extends BaseDeclarativeTool<
  KnowledgeToolParams,
  ToolResult
> {
  static readonly Name = ToolNames.KNOWLEDGE;

  constructor(private readonly config: Config) {
    super(
      KnowledgeTool.Name,
      ToolDisplayNames.KNOWLEDGE,
      DESCRIPTION,
      Kind.Search,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Text to search for in the SDD knowledge base (case-insensitive, line by line).',
          },
          type: {
            type: 'string',
            enum: [...KNOWLEDGE_TYPES],
            description:
              'Optional: restrict the search to a single concept type.',
          },
        },
        required: ['query'],
      },
    );
  }

  protected override validateToolParamValues(
    params: KnowledgeToolParams,
  ): string | null {
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    if (params.type && !KNOWLEDGE_TYPES.includes(params.type)) {
      return `Invalid 'type': must be one of ${KNOWLEDGE_TYPES.join(', ')}.`;
    }
    return null;
  }

  protected createInvocation(
    params: KnowledgeToolParams,
  ): ToolInvocation<KnowledgeToolParams, ToolResult> {
    return new KnowledgeToolInvocation(this.config, params);
  }
}
