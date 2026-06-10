import { getEmbedder } from './embed.js';
import { getPool, getRagSchema } from './pool.js';

export interface RagHit {
  source: string;
  chunkText: string;
  metadata: Record<string, unknown>;
  score: number;
}

export async function searchRag(query: string, k: number): Promise<RagHit[]> {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      'RAG store not configured. Set LEMMA_RAG_DSN to your Postgres connection string.',
    );
  }

  const schema = getRagSchema();
  const embedder = await getEmbedder();
  const queryVec = await embedder.embedQuery(query);
  const vecLiteral = `[${queryVec.join(',')}]`;

  const sql = `
    SELECT source, chunk_text, metadata, 1 - (embedding <=> $1::vector) AS score
    FROM "${schema}".chunks
    ORDER BY embedding <=> $1::vector
    LIMIT $2
  `;

  const result = await pool.query<{
    source: string;
    chunk_text: string;
    metadata: Record<string, unknown> | null;
    score: string | number;
  }>(sql, [vecLiteral, k]);

  return result.rows.map((row) => ({
    source: row.source,
    chunkText: row.chunk_text,
    metadata: row.metadata ?? {},
    score: typeof row.score === 'string' ? Number(row.score) : row.score,
  }));
}
