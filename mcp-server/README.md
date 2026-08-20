# @artano-ai/mcp-server

[Lemma](../cards/README.md)'s MCP server — exposes the open cards corpus and verification engines to any [MCP](https://modelcontextprotocol.io)-compatible client.

The server is the canonical distribution surface for the Lemma substrate. Plug it into claude-code, Cursor, Codex, Gemini Code Assist, or any MCP-aware tool-use runtime and gain access to:

### Cards & verification

- **`cards_list`** — list curated scientific principle cards in the local seed corpus (condensed-matter physics, classical mechanics, chemistry — the corpus is domain-agnostic and grows over time). Optional `domain` substring filter.
- **`cards_get`** — fetch a full card record (PrincipleCard or HypothesisCard) by id. Returns the JSON payload. Refuses to fabricate — unknown ids produce a structured error listing valid ids.
- **`ops_get`** — fetch an OpsCard (SLURM / Snakemake / Singularity recipes) rendered as Markdown for direct LLM consumption.
- **`hypothesis_crosscheck`** — run the hypothesis cross-check engine on a HypothesisCard. Pass either an `id` (existing card) or an inline `card` object (e.g. one freshly proposed by an LLM). Verifies dimensional analysis (real), reference-corpus resolution (real), declared limit / conservation claims (recorded as warnings pending symbolic verification), and `derivedFrom` link resolution. Returns a verdict + diagnosis.

- **`series_check`** — check a reported series against the sign and bound conditions a card declares in `seriesConditions`. Reaches cards `usce_check` structurally cannot: a density of states has no system-independent magnitude, so those cards declare no envelopes at all, but it can never be negative in any material.
- **`convergence_check`** — recompute an order of accuracy from an `[h, error]` refinement study rather than trusting a reported number. A study contaminated by round-off-limited levels warns with the per-level orders attached rather than failing — that is a bad measurement, not a wrong method.
- **`agreement_check`** — check whether independent methods agree, within a card's `crossMethodTolerances`. One relation above `usce_check`: an envelope bounds one run's value, this bounds the disagreement *between* runs. Fewer than two methods is an error, because a single method cannot corroborate itself.

### Retrieval

- **`rag_lookup`** — semantic search over a Postgres + pgvector corpus **you populate yourself**, returning the most relevant passages. Nothing is bundled: point `lemma-rag ingest` at your own documentation (see [Building the retrieval index](#building-the-retrieval-index)). When no index is configured, or it holds no matches, the tool says so explicitly rather than returning an empty result that reads like "no such thing exists".

Tools deliberately omitted: `read_file`, `write_file`, `list_files`, `run_shell`. Every modern tool-use runtime already provides those — this server adds the scientific layer on top.

---

## Install

```sh
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env.local` and fill in at least `LEMMA_RAG_DSN`. The other variables have working defaults for local development.

`LEMMA_RAG_DSN` is only needed for `rag_lookup`. The other eight tools read the bundled cards corpus and need no database at all.

## Building the retrieval index

`rag_lookup` searches an index you build. This package ships the tool to build it — `lemma-rag` — but no corpus.

You need Postgres with the `pgvector` extension:

```sh
export LEMMA_RAG_DSN="postgres://user:pass@localhost:5432/lemma"

lemma-rag init                       # create the schema, table and indexes
lemma-rag ingest ./docs              # chunk, embed and upsert a directory
lemma-rag ingest handbook.md         # …or a single file
lemma-rag status                     # what is currently indexed
lemma-rag forget /abs/path/to/doc.md # remove one source
```

`ingest` picks up `.md`, `.txt` and `.rst` under a directory (`--ext` to change that), splits on paragraph and sentence boundaries with overlap so a fact spanning a boundary stays retrievable, and **upserts** — re-ingesting an unchanged document is a no-op rather than a silent duplication that would skew retrieval toward whatever was ingested most often.

Two things worth knowing:

- **The vector column is sized from your embedder** — 768 for the default local model, 3072 for `gemini-embedding-001`. Switching providers against an existing index is refused with an explanation, rather than failing later on a Postgres type error that never mentions the embedding model.
- **The ANN index is built after the first load, not before.** `ivfflat` clusters the rows it can see, so building it on an empty table gives lists that partition nothing and quietly degrades retrieval.

The raw DDL is in [`src/rag/schema.sql`](src/rag/schema.sql) if you would rather apply it yourself.

## Wire it into a client

Most MCP clients accept a stdio server defined in a JSON config. The exact location of that config depends on the client. The shape is universal:

```json
{
  "mcpServers": {
    "lemma": {
      "command": "node",
      "args": ["/absolute/path/to/repo/mcp-server/dist/index.js"],
      "env": {
        "LEMMA_RAG_DSN": "postgresql://you@localhost:5432/atomira_lab"
      }
    }
  }
}
```

Once the client restarts, the tools appear and can be called the same way as any other tool the client exposes.

The cards/hypothesis tools work with no env config — they read from the bundled seed corpus. Only `rag_lookup` needs `LEMMA_RAG_DSN`; the others are optional.

## Run from source (dev)

```sh
pnpm dev
```

Speaks MCP over stdio. Connect any MCP client to it (or use the bundled smoke test once it's added).

## What this is and isn't

- This server is **infrastructure**. It does not call an LLM, does not maintain conversation state, and does not know which client is calling it. It just exposes tools.
- It is **one of several clients** of the same Lemma backend (cards corpus + USCE + cross-check engine) — alongside the Python SDK, a CLI, IDE extensions, and web front-ends. Those are independent consumers of the substrate, not part of this package.
- For the wider Lemma architecture (cards corpus, hypothesis cross-check engine, provenance), see `../cards/README.md` and the JSON Schema at `../schema/card.v0.1.json`.

## License

Apache-2.0. The cards corpus bundled into the published package
(`dist/_corpus/`) is CC-BY 4.0 — its `LICENSE` travels with it; attribution to
Atomira Technologies, S.L. and the Lemma card authors.
