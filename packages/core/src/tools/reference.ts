/**
 * @license
 * Copyright 2025 Axe
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolInvocation, ToolResult } from './tools.js';
import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import { ToolNames, ToolDisplayNames } from './tool-names.js';
import type { Config } from '../config/config.js';
import type { IReferenceService } from '../services/reference/types.js';

export interface ReferenceToolParams {
  package: string;
  query?: string;
}

const DESCRIPTION = `Searches the REAL source code of an installed dependency — the exact version resolved in this project — instead of relying on memory or guessing an API.

Use this before calling into a third-party library whose API you are unsure of: search its actual source for the function, class, type, or option you need. Results are match blocks with surrounding context lines, ranked so type definitions and hand-written source come before compiled output and docs.

- \`package\`: any package installed under \`node_modules\` (e.g. \`react\`, \`@tanstack/react-query\`). Direct dependencies are pre-indexed; transitive dependencies (e.g. the core package behind a framework adapter) are indexed on demand — if an API seems to live in a sub-dependency, search that package directly by name.
- \`query\` (optional): an exact identifier (\`sendMagicCode\`, \`LinkDef\`) OR a natural-language description of what you need ("subscribe to auth state changes"). Identifiers return every exact occurrence with surrounding context; descriptions are answered by semantic search over the package's docs and API surface (a "Related (semantic)" section). OMIT the query entirely to list the package's exported API surface (every export with its signature).

**Pivot rule**: if a search finds nothing useful, DO NOT retry with keyword synonyms. Instead:
1. Re-query describing the INTENT in natural language — semantic search maps it to the right identifiers.
2. Call this tool with only \`package\` (no query) to browse its exports, then search the exact name you find.
3. Last resort: read the \`.d.ts\` entry point (\`node_modules/pkg/dist/index.d.ts\`) or grep the dist directly.

After each search, state in one sentence what you found (or did not find) before deciding whether to search again.

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
    const query = this.params.query?.trim();
    return query
      ? `Search ${this.params.package} source: "${query}"`
      : `List ${this.params.package} exported API`;
  }

  private renderReason(
    service: IReferenceService,
    reason: 'not-a-dependency' | 'pending' | 'errored',
    detail?: string,
  ): ToolResult {
    let msg: string;
    if (reason === 'not-a-dependency') {
      const active = service
        .getActivePackages()
        .map((p) => p.name)
        .join(', ');
      msg = `"${this.params.package}" was not found in this project's dependencies or node_modules.${
        active ? ` Pre-indexed packages: ${active}.` : ''
      } Transitive dependencies can be searched by their exact package name.`;
    } else if (reason === 'errored') {
      msg = `Source for "${this.params.package}" could not be indexed: ${
        detail ?? 'unknown error'
      }. Fall back to your own knowledge, and verify against the running code.`;
    } else {
      msg = `Source for "${this.params.package}" is still being indexed. Try again shortly, or proceed carefully without it.`;
    }
    return { llmContent: msg, returnDisplay: msg };
  }

  private async listExports(
    service: IReferenceService,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const outcome = await service.getExports(this.params.package, signal);
    if (outcome.reason) {
      return this.renderReason(service, outcome.reason, outcome.detail);
    }
    const pkgVersion = `${this.params.package}@${outcome.entry?.version ?? '?'}`;
    if (outcome.exports.length === 0) {
      const msg = `No exported symbols were detected in ${pkgVersion} source. Read its \`.d.ts\` entry point directly.`;
      return { llmContent: msg, returnDisplay: msg };
    }
    const body = outcome.exports
      .map((e) => `- ${e.signature} — ${e.file}`)
      .join('\n');
    const header = `Exported API surface of ${pkgVersion} (${outcome.exports.length} symbols). Search an exact name for full context:`;
    return {
      llmContent: `${header}\n${body}`,
      returnDisplay: `${header}\n\n${body}`,
    };
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const service = this.config.getReferenceService();
    if (!service) {
      const msg = 'The reference index is not available in this session.';
      return { llmContent: msg, returnDisplay: msg };
    }

    const query = this.params.query?.trim();
    if (!query) {
      return this.listExports(service, signal);
    }

    const outcome = await service.search(this.params.package, query, signal);

    if (outcome.reason) {
      return this.renderReason(service, outcome.reason, outcome.detail);
    }

    if (outcome.results.length === 0) {
      let msg = `No exact matches for "${query}" in ${this.params.package}@${
        outcome.entry?.version ?? '?'
      } source.`;
      if (outcome.semantic && outcome.semantic.length > 0) {
        const blocks = outcome.semantic
          .map((r) => `${r.file}:${r.line}:\n${r.snippet}`)
          .join('\n\n');
        msg += `\nSemantically related content (docs and API surface):\n\n${blocks}`;
        return {
          llmContent: msg,
          returnDisplay: `${msg.split('\n')[0]}\nSemantically related content (docs and API surface):\n\n\`\`\`\n${blocks}\n\`\`\``,
        };
      }
      const { exports } = await service.getExports(this.params.package, signal);
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const near = exports.filter((e) =>
        tokens.some((t) => e.name.toLowerCase().includes(t)),
      );
      if (near.length > 0) {
        const suggestions = near
          .slice(0, 10)
          .map((e) => `- ${e.signature} — ${e.file}`)
          .join('\n');
        msg += `\nExported symbols with similar names:\n${suggestions}`;
      } else if (exports.length > 0) {
        msg += ` The package exports ${exports.length} symbols — call this tool with only \`package\` (no query) to browse its API surface.`;
      }
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
    let semanticSection = '';
    if (outcome.semantic && outcome.semantic.length > 0) {
      const related = outcome.semantic
        .map((r) => `${r.file}:${r.line}:\n${r.snippet}`)
        .join('\n\n');
      semanticSection = `\n\nRelated (semantic):\n${related}`;
    }
    return {
      llmContent: `${header}\n${body}${semanticSection}`,
      returnDisplay: `${header}\n\n\`\`\`\n${body}${semanticSection}\n\`\`\``,
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
              'Optional. Omit to list the package exported API surface. Otherwise prefer one exact identifier per call (single term = regex). Multiple words OR-match as whole words and are relevance-ranked; avoid natural-language phrases.',
          },
        },
        required: ['package'],
      },
    );
  }

  protected override validateToolParamValues(
    params: ReferenceToolParams,
  ): string | null {
    if (!params.package || params.package.trim() === '') {
      return "The 'package' parameter cannot be empty.";
    }
    return null;
  }

  protected createInvocation(
    params: ReferenceToolParams,
  ): ToolInvocation<ReferenceToolParams, ToolResult> {
    return new ReferenceToolInvocation(this.config, params);
  }
}
