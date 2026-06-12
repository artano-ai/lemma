// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { ALL_CARDS, OPS_CARDS } from '../cards/seed.js';
import type { McpTool } from './types.js';

export const cardsListTool: McpTool = {
  name: 'cards_list',
  description:
    'List Lemma cards in the local seed corpus. Returns id, name, domain, version, and a one-line summary for each card. Includes both principle cards (physics, chemistry, biology, …) and ops cards (SLURM templates, workflow recipes). Optionally filter by `domain` substring (e.g. "physics", "chemistry-thermo", "ops"). Use cards_get to retrieve the full record for a specific id.',
  inputSchema: {
    type: 'object',
    properties: {
      domain: {
        type: 'string',
        description:
          'Case-insensitive substring filter on the card.domain field (or "ops" to filter to ops cards only). Omit to list every card.',
      },
    },
  },
  async run(input) {
    const filter =
      typeof input.domain === 'string' ? input.domain.toLowerCase().trim() : '';

    const principleMatches = filter
      ? ALL_CARDS.filter((c) => (c.domain ?? '').toLowerCase().includes(filter))
      : ALL_CARDS;
    const opsMatches =
      filter === '' || 'ops'.includes(filter) || filter === 'ops'
        ? OPS_CARDS
        : [];

    if (principleMatches.length === 0 && opsMatches.length === 0) {
      const known = unique(ALL_CARDS.map((c) => c.domain ?? 'uncategorised'));
      return `No cards match domain filter "${filter}". Known principle-card domains: ${known.join(', ')}. Use domain="ops" to filter to ops cards only.`;
    }

    const blocks: string[] = [];

    if (principleMatches.length > 0) {
      const grouped = new Map<string, typeof principleMatches>();
      for (const c of principleMatches) {
        const key = c.domain ?? 'uncategorised';
        const bucket = grouped.get(key) ?? [];
        bucket.push(c);
        grouped.set(key, bucket);
      }
      for (const [domain, list] of grouped) {
        blocks.push(`## ${domain} — ${list.length} card${list.length === 1 ? '' : 's'}`);
        for (const c of list) {
          blocks.push(
            `- **${c.id}** v${c.version} — ${c.name}\n  principles: ${c.principles.join(' · ')}`,
          );
        }
      }
    }

    if (opsMatches.length > 0) {
      blocks.push(
        `## ops — ${opsMatches.length} ops card${opsMatches.length === 1 ? '' : 's'}`,
      );
      for (const c of opsMatches) {
        blocks.push(`- **${c.id}** v${c.version} — ${c.name}\n  ${c.description.slice(0, 140)}${c.description.length > 140 ? '…' : ''}`);
      }
    }

    const totalReturned = principleMatches.length + opsMatches.length;
    const totalCorpus = ALL_CARDS.length + OPS_CARDS.length;
    blocks.push(
      `\n_${totalReturned} card(s) returned of ${totalCorpus} in corpus (${ALL_CARDS.length} principle + ${OPS_CARDS.length} ops)._`,
    );
    return blocks.join('\n');
  },
};

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
