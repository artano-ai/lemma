// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { runHypothesisChecks } from '../cards/checks.js';
import {
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  findHypothesisCard,
} from '../cards/seed.js';
import type { HypothesisCard } from '../cards/types.js';
import type { McpTool } from './types.js';

export const hypothesisCrosscheckTool: McpTool = {
  name: 'hypothesis_crosscheck',
  description:
    'Run the Lemma hypothesis cross-check engine on a HypothesisCard. Pass either an `id` (a hypothesis already in the seed corpus, e.g. "free-fall-with-linear-drag") OR a `card` object (an inline HypothesisCard, e.g. one freshly proposed by an LLM). Returns the verdict: dimensional analysis (real), reference-corpus resolution (real), declared limit / conservation claims (warn pending symbolic verification), and a diagnosis. The corpus the hypothesis is checked against is the local seed corpus.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Id of an existing HypothesisCard in the seed corpus. Mutually exclusive with `card`.',
      },
      card: {
        type: 'object',
        description:
          'Inline HypothesisCard — full JSON record, kind: "hypothesis". Use this to check a freshly proposed card before it is added to the corpus. Schema: see lemma/schema/card.v0.1.json (HypothesisCard $def).',
      },
    },
  },
  async run(input) {
    let card: HypothesisCard | undefined;

    if (typeof input.id === 'string' && input.id) {
      card = findHypothesisCard(input.id);
      if (!card) {
        const known = HYPOTHESIS_CARDS.map((c) => c.id).join(', ') || '(none)';
        throw new Error(
          `No hypothesis card with id "${input.id}". Known: ${known}.`,
        );
      }
    } else if (input.card && typeof input.card === 'object') {
      const candidate = input.card as Partial<HypothesisCard>;
      if (candidate.kind !== 'hypothesis') {
        throw new Error(
          `Inline card.kind must be "hypothesis" (got "${candidate.kind ?? 'undefined'}").`,
        );
      }
      if (!candidate.id || !candidate.name || !candidate.checks) {
        throw new Error(
          'Inline hypothesis card must have id, name, and checks fields at minimum.',
        );
      }
      card = candidate as HypothesisCard;
    } else {
      throw new Error(
        'Provide either `id` (existing card) or `card` (inline HypothesisCard JSON).',
      );
    }

    const verdict = runHypothesisChecks(card, { corpus: ALL_CARDS });

    const lines: string[] = [];
    lines.push(`# Cross-check verdict — ${card.name}`);
    lines.push(`Card: \`${card.id}\` v${card.version} · origin: ${card.origin}`);
    if (card.derivedFrom) {
      lines.push(
        `Derived: ${card.derivedFrom.relationship} \`${card.derivedFrom.cardId}\``,
      );
    }
    lines.push(
      `\n**Overall:** ${verdict.overall.passing} / ${verdict.overall.total} pass · severity ${verdict.overall.severity}`,
    );
    lines.push('');
    for (const c of verdict.checks) {
      const mark =
        c.severity === 'pass' ? '✓' : c.severity === 'warn' ? '!' : '✗';
      lines.push(`- [${mark}] **${c.name}** — ${c.detail}`);
    }
    lines.push('');
    lines.push(`**Diagnosis:** ${verdict.diagnosis}`);
    lines.push('');
    lines.push('---');
    lines.push('Raw JSON:');
    lines.push('```json');
    lines.push(JSON.stringify(verdict, null, 2));
    lines.push('```');

    return lines.join('\n');
  },
};
