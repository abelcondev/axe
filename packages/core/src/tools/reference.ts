/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';
import type { Config } from '../config/config.js';

export interface ReferenceToolParams {
  package: string;
  query: string;
}

const DESCRIPTION = `Searches the REAL source code of an installed dependency — the exact version resolved in this project — instead of relying on memory or guessing an API.

Use this before calling into a third-party library whose API you are unsure of: search its actual source for the function, class, type, or option you need. Results are match blocks with surrounding context lines, ranked so type definitions and hand-written source come before compiled output and docs.

- \`package\`: any package installed under \`node_modules\` (e.g. \`react\`, \`@tanstack/react-query\`). Direct dependencies are pre-indexed; transitive dependencies (e.g. the core package behind a framework adapter) are indexed on demand — if an API seems to live in a sub-dependency, search that package directly by name.
- \`query\`: PREFER one exact identifier per call (e.g. \`sendMagicCode\`). A single term is treated as a ripgrep pattern (regex allowed). Multiple words are OR-matched as whole words and ranked by how many distinct words each block hits — do NOT write natural-language phrases.

The set of pre-indexed packages is listed in the system prompt under "Dependency source references".`;

class ReferenceToolInvocation extends BaseToolInvocation<
  ReferenceToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ReferenceToolParams,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Search ${this.params.package} source: "${this.params.query}"`;
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const service = this.config.getReferenceService();
    if (!service) {
      const msg = 'The reference index is not available in this session.';
      return { llmContent: msg, returnDisplay: msg };
    }

    const outcome = await service.search(
      this.params.package,
      this.params.query,
      signal,
    );

    if (outcome.reason === 'not-a-dependency') {
      const active = service
        .getActivePackages()
        .map((p) => p.name)
        .join(', ');
      const msg = `"${this.params.package}" was not found in this project's dependencies or node_modules.${
        active ? ` Pre-indexed packages: ${active}.` : ''
      } Transitive dependencies can be searched by their exact package name.`;
      return { llmContent: msg, returnDisplay: msg };
    }
    if (outcome.reason === 'errored') {
      const msg = `Source for "${this.params.package}" could not be indexed: ${
        outcome.detail ?? 'unknown error'
      }. Fall back to your own knowledge, and verify against the running code.`;
      return { llmContent: msg, returnDisplay: msg };
    }
    if (outcome.reason === 'pending') {
      const msg = `Source for "${this.params.package}" is still being indexed. Try again shortly, or proceed carefully without it.`;
      return { llmContent: msg, returnDisplay: msg };
    }

    if (outcome.results.length === 0) {
      const msg = `No matches for "${this.params.query}" in ${this.params.package}@${
        outcome.entry?.version ?? '?'
      } source.`;
      return { llmContent: msg, returnDisplay: msg };
    }

    const blocks = outcome.results.map((r) =>
      r.snippet.includes('\n')
        ? `${r.file}:${r.line}:\n${r.snippet}`
        : `${r.file}:${r.line}: ${r.snippet}`,
    );
    const body = blocks.join('\n\n');
    const header = `Found ${outcome.results.length} match(es) in ${this.params.package}@${
      outcome.entry?.version ?? '?'
    } source:`;
    return {
      llmContent: `${header}\n${body}`,
      returnDisplay: `${header}\n\n\`\`\`\n${body}\n\`\`\``,
    };
  }
}

export class ReferenceTool extends BaseDeclarativeTool<
  ReferenceToolParams,
  ToolResult
> {
  static readonly Name = ToolNames.REFERENCE;

  constructor(private readonly config: Config) {
    super(
      ReferenceTool.Name,
      ToolDisplayNames.REFERENCE,
      DESCRIPTION,
      Kind.Search,
      {
        type: 'object',
        properties: {
          package: {
            type: 'string',
            description:
              'Any package name installed under node_modules (e.g. `react`), including transitive dependencies.',
          },
          query: {
            type: 'string',
            description:
              'Prefer one exact identifier per call (single term = regex). Multiple words OR-match as whole words and are relevance-ranked; avoid natural-language phrases.',
          },
        },
        required: ['package', 'query'],
      },
    );
  }

  protected override validateToolParamValues(
    params: ReferenceToolParams,
  ): string | null {
    if (!params.package || params.package.trim() === '') {
      return "The 'package' parameter cannot be empty.";
    }
    if (!params.query || params.query.trim() === '') {
      return "The 'query' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: ReferenceToolParams,
  ): ToolInvocation<ReferenceToolParams, ToolResult> {
    return new ReferenceToolInvocation(this.config, params);
  }
}
