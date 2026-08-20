// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Fill the index that `rag_lookup` reads from.
 *
 * The retrieval half of RAG shipped a while ago — embedder, pool, cosine
 * search. The ingestion half did not, which left `rag_lookup` registered as one
 * of six MCP tools while being impossible to use: there was no table DDL
 * anywhere in the repo, and `embedDocument` was implemented on both embedders
 * and called from nowhere. This is that missing half.
 *
 * ## What it deliberately does not do
 *
 * It does not ship a scientific corpus. The tool description used to promise
 * passages from "the Siesta manual, ASE, pymatgen, numerical methods, HPC docs"
 * — none of which are in this repository, and none of which are ours to
 * redistribute. This ingests **files you point it at**, and the tool now says
 * so. A search tool that names sources it cannot supply sends people to debug
 * an empty result set that is working exactly as built.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

import { chunkText, contentKey, type ChunkOptions } from './chunk.js';
import { getEmbedder } from './embed.js';
import { getPool, getRagSchema } from './pool.js';

export interface IngestOptions extends ChunkOptions {
  /** Label recorded on every chunk. Defaults to the file path. */
  source?: string;
  /** Rows per INSERT. Batched because one statement per chunk is slow. */
  batchSize?: number;
  /** Called after each batch, for progress reporting. */
  onProgress?: (done: number, total: number) => void;
}

export interface IngestResult {
  source: string;
  chunks: number;
  inserted: number;
  updated: number;
}

function requirePool(): Pool {
  const pool = getPool();
  if (!pool) {
    throw new Error(
      'RAG store not configured. Set LEMMA_RAG_DSN to your Postgres connection string.',
    );
  }
  return pool;
}

/**
 * Create the schema, extension, table and indexes.
 *
 * The embedding column is sized from the **configured embedder**, not from a
 * constant: 768 for the default Qwen3-0.6B ONNX, 3072 for
 * `gemini-embedding-001`. A column typed to the wrong width fails at insert
 * time with a Postgres error that never mentions the embedding model, which is
 * a genuinely confusing way to discover a config mismatch.
 */
export async function initRagStore(): Promise<{ schema: string; dim: number }> {
  const pool = requirePool();
  const schema = getRagSchema();
  const embedder = await getEmbedder();
  const dim = embedder.dim;

  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${schema}".chunks (
      id          bigserial PRIMARY KEY,
      source      text        NOT NULL,
      chunk_text  text        NOT NULL,
      metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
      embedding   vector(${dim}) NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      content_key text        NOT NULL,
      UNIQUE (source, content_key)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS chunks_source_idx ON "${schema}".chunks (source)`,
  );

  // Guard the mismatch this function exists to prevent: if the table already
  // existed with a different width, say so in terms of the embedder rather
  // than letting the first insert fail on a type error.
  const existing = await pool.query<{ dims: number | null }>(
    `SELECT a.atttypmod AS dims
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = 'chunks' AND a.attname = 'embedding'`,
    [schema],
  );
  const found = existing.rows[0]?.dims;
  if (typeof found === 'number' && found > 0 && found !== dim) {
    throw new Error(
      `The existing "${schema}".chunks table stores ${found}-dimensional vectors, but the ` +
        `configured embedder produces ${dim}. Mixing dimensions in one index is not ` +
        `meaningful — re-ingest into a fresh LEMMA_RAG_SCHEMA, or drop the table first.`,
    );
  }

  return { schema, dim };
}

/**
 * Build the ANN index.
 *
 * Run **after** the first bulk load, never before: ivfflat clusters the rows it
 * can see, so building it on an empty table produces lists that partition
 * nothing and retrieval quality suffers silently.
 */
export async function buildRagIndex(lists = 100): Promise<void> {
  const pool = requirePool();
  const schema = getRagSchema();
  await pool.query(`
    CREATE INDEX IF NOT EXISTS chunks_embedding_idx
      ON "${schema}".chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = ${Math.max(1, Math.floor(lists))})
  `);
}

/** Chunk, embed and upsert one document. */
export async function ingestText(
  text: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const pool = requirePool();
  const schema = getRagSchema();
  const embedder = await getEmbedder();
  const source = options.source ?? '(inline)';
  const batchSize = Math.max(1, options.batchSize ?? 32);

  const chunks = chunkText(text, options);
  if (chunks.length === 0) {
    return { source, chunks: 0, inserted: 0, updated: 0 };
  }

  let inserted = 0;
  let updated = 0;

  for (let start = 0; start < chunks.length; start += batchSize) {
    const batch = chunks.slice(start, start + batchSize);
    const embeddings = await Promise.all(
      batch.map((chunk) => embedder.embedDocument(chunk.text)),
    );

    const values: unknown[] = [];
    const rows = batch.map((chunk, i) => {
      const base = i * 5;
      values.push(
        source,
        chunk.text,
        JSON.stringify({ index: chunk.index, provider: embedder.provider }),
        `[${embeddings[i]!.join(',')}]`,
        contentKey(chunk.text),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}::jsonb, $${base + 4}::vector, $${base + 5})`;
    });

    // Upsert on (source, content_key): re-ingesting an unchanged document is a
    // no-op rather than a silent duplication that would skew retrieval toward
    // whatever was ingested most often.
    const result = await pool.query<{ inserted: boolean }>(
      `
      INSERT INTO "${schema}".chunks (source, chunk_text, metadata, embedding, content_key)
      VALUES ${rows.join(', ')}
      ON CONFLICT (source, content_key) DO UPDATE
        SET chunk_text = EXCLUDED.chunk_text,
            metadata   = EXCLUDED.metadata,
            embedding  = EXCLUDED.embedding
      RETURNING (xmax = 0) AS inserted
      `,
      values,
    );
    for (const row of result.rows) {
      if (row.inserted) inserted += 1;
      else updated += 1;
    }
    options.onProgress?.(Math.min(start + batch.length, chunks.length), chunks.length);
  }

  return { source, chunks: chunks.length, inserted, updated };
}

/** Read a file from disk and ingest it. */
export async function ingestFile(
  filePath: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const text = await readFile(filePath, 'utf8');
  return ingestText(text, { ...options, source: options.source ?? path.resolve(filePath) });
}

/** Remove everything previously ingested under a source label. */
export async function forgetSource(source: string): Promise<number> {
  const pool = requirePool();
  const schema = getRagSchema();
  const result = await pool.query(`DELETE FROM "${schema}".chunks WHERE source = $1`, [source]);
  return result.rowCount ?? 0;
}
