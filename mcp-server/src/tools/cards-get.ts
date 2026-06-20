// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import {
  ALL_CARDS,
  OPS_CARDS,
  findHypothesisCard,
  findOpsCard,
  findPrincipleCard,
} from '../cards/seed.js';
import type { McpTool } from './types.js';

export const cardsGetTool: McpTool = {
  name: 'cards_get',
  description:
    'Fetch a full Lemma card by id. Returns the JSON record (PrincipleCard, OpsCard, or HypothesisCard). Use cards_list first to discover available ids. Returns an error if the id is unknown — Lemma refuses to fabricate cards on demand.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Card id, e.g. "lindhard-susceptibility", "free-fall-uniform-gravity", "slurm-mn5-gpu", "free-fall-with-linear-drag".',
      },
    },
    required: ['id'],
  },
  async run(input) {
    const id = String(input.id ?? '').trim();
    if (!id) {
      throw new Error('Empty id.');
    }

    const principle = findPrincipleCard(id);
    if (principle) {
      const { metadata: _p, ...rest } = principle;
      return JSON.stringify(rest, null, 2);
    }

    const ops = findOpsCard(id);
    if (ops) {
      const { metadata: _o, ...rest } = ops;
      return JSON.stringify(rest, null, 2);
    }

    const hypothesis = findHypothesisCard(id);
    if (hypothesis) {
      const { metadata: _h, ...rest } = hypothesis;
      return JSON.stringify(rest, null, 2);
    }

    const knownPrinciples = ALL_CARDS.map((c) => c.id).join(', ');
    const knownOps = OPS_CARDS.map((c) => c.id).join(', ');
    throw new Error(
      `No card with id "${id}" in the seed corpus. Known principle-card ids: ${knownPrinciples}. Known ops-card ids: ${knownOps}. (Hypothesis cards are listed separately — see hypothesis_crosscheck.)`,
    );
  },
};
