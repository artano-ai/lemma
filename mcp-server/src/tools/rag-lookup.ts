// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { searchRag } from '../rag/search.js';
import type { McpTool } from './types.js';

const PASSAGE_PREVIEW_CHARS = 1200;

export const ragLookupTool: McpTool = {
  name: 'rag_lookup',
  // Names no specific sources. The previous wording promised passages from "the
  // Siesta manual, ASE, pymatgen, numerical methods, HPC docs" — none of which
  // ship with this package, and none of which are ours to redistribute. A tool
  // that advertises content it cannot supply sends a user to debug an empty
  // result set that is behaving exactly as built.
  description:
    'Semantic search over a self-hosted corpus of scientific documentation, returning the most relevant passages. Requires a Postgres + pgvector index that you populate yourself with `lemma-rag ingest` (set LEMMA_RAG_DSN); nothing is bundled. Returns an explicit notice rather than an empty result when no index is configured or it holds no matches.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language query.' },
      k: {
        type: 'number',
        description: 'Number of passages to retrieve (default 5, capped at 20).',
      },
    },
    required: ['query'],
  },
  async run(input) {
    const query = String(input.query ?? '').trim();
    if (!query) {
      throw new Error('Empty query.');
    }
    const k = Math.min(Math.max(Number(input.k ?? 5) || 5, 1), 20);

    const hits = await searchRag(query, k);
    if (hits.length === 0) {
      return (
        'No matches in the configured RAG corpus. If you have not indexed anything yet, ' +
        'the index is empty rather than the query being unanswerable — populate it with ' +
        '`lemma-rag ingest <path>` and check what is loaded with `lemma-rag status`.'
      );
    }

    const blocks = hits.map((h, i) => {
      const text =
        h.chunkText.length > PASSAGE_PREVIEW_CHARS
          ? h.chunkText.slice(0, PASSAGE_PREVIEW_CHARS) + '…'
          : h.chunkText;
      return `[${i + 1}] ${h.source} (score=${h.score.toFixed(3)})\n${text}`;
    });
    return blocks.join('\n\n---\n\n');
  },
};
