-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Atomira Technologies, S.L.
--
-- The table `rag_lookup` reads from.
--
-- Until this file existed, the shape was discoverable only by reading the
-- SELECT in `search.ts` and inferring the columns — so anyone wanting to use
-- `rag_lookup` had to reverse-engineer the schema from a query. The retrieval
-- half of RAG shipped; this is the half that lets you fill it.
--
-- Apply it with:
--
--   psql "$LEMMA_RAG_DSN" -v schema=atomira_lab -f src/rag/schema.sql
--
-- or let `lemma-rag ingest --init` run it for you.

\set schema_name :schema

-- pgvector supplies the `vector` type and the distance operators the search
-- uses (`<=>` is cosine distance).
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS :"schema_name";

CREATE TABLE IF NOT EXISTS :"schema_name".chunks (
  id          bigserial PRIMARY KEY,
  -- Where the passage came from. Shown to the model in every hit, so it should
  -- be something a human can act on — a file path, a URL, a document title.
  source      text        NOT NULL,
  chunk_text  text        NOT NULL,
  -- Free-form provenance: page number, section heading, ingest timestamp.
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Dimensionality is NOT fixed here on purpose. It depends on the embedding
  -- model (768 for the default Qwen3-0.6B ONNX, 3072 for gemini-embedding-001),
  -- and a column typed to the wrong width fails at insert with an error that
  -- does not mention the model. `lemma-rag ingest --init` sizes it from the
  -- configured embedder; if you apply this file by hand, substitute :dim.
  embedding   vector(:dim) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- The same source ingested twice should replace, not duplicate. Without this
  -- a re-ingest silently doubles every passage and skews retrieval toward
  -- whatever was ingested most often.
  content_key text        NOT NULL,
  UNIQUE (source, content_key)
);

-- Approximate-nearest-neighbour index. Cosine, matching the `<=>` in search.ts.
-- Built AFTER the first bulk load in `ingest`, because building it on an empty
-- table gives ivfflat no data to cluster on and the lists end up meaningless.
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON :"schema_name".chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS chunks_source_idx ON :"schema_name".chunks (source);
