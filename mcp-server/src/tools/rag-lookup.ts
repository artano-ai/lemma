import { searchRag } from '../rag/search.js';
import type { McpTool } from './types.js';

const PASSAGE_PREVIEW_CHARS = 1200;

export const ragLookupTool: McpTool = {
  name: 'rag_lookup',
  description:
    'Search the local scientific knowledge base (Siesta manual, ASE, pymatgen, numerical methods, HPC docs) and return the most relevant passages.',
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
      return 'No matches in the local RAG corpus. The index may be empty — run the bootstrap and indexing scripts in artano-code/rag/ first.';
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
