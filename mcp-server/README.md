# @artano-ai/mcp-server

[Lemma](../cards/README.md)'s MCP server — exposes the open cards corpus and verification engines to any [MCP](https://modelcontextprotocol.io)-compatible client.

The server is the canonical distribution surface for the Lemma substrate. Plug it into claude-code, Cursor, Codex, Gemini Code Assist, or any MCP-aware tool-use runtime and gain access to:

### Cards & verification

- **`cards_list`** — list curated scientific principle cards in the local seed corpus (condensed-matter physics, classical mechanics, chemistry — the corpus is domain-agnostic and grows over time). Optional `domain` substring filter.
- **`cards_get`** — fetch a full card record (PrincipleCard or HypothesisCard) by id. Returns the JSON payload. Refuses to fabricate — unknown ids produce a structured error listing valid ids.
- **`ops_get`** — fetch an OpsCard (SLURM / Snakemake / Singularity recipes) rendered as Markdown for direct LLM consumption.
- **`hypothesis_crosscheck`** — run the hypothesis cross-check engine on a HypothesisCard. Pass either an `id` (existing card) or an inline `card` object (e.g. one freshly proposed by an LLM). Verifies dimensional analysis (real), reference-corpus resolution (real), declared limit / conservation claims (recorded as warnings pending symbolic verification), and `derivedFrom` link resolution. Returns a verdict + diagnosis.

### Retrieval

- **`rag_lookup`** — retrieves passages from a Postgres + pgvector corpus indexed over the Siesta manual, ASE, pymatgen, numerical methods, SLURM/MareNostrum docs, and any extra source you point it at.

Tools deliberately omitted: `read_file`, `write_file`, `list_files`, `run_shell`. Every modern tool-use runtime already provides those — this server adds the scientific layer on top.

---

## Install

```sh
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env.local` and fill in at least `LEMMA_RAG_DSN`. The other variables have working defaults for local development.

The Postgres database must have the `pgvector` extension enabled and a `chunks` table of embedded passages. The server reads from that table; building and populating it (embedding your sources, then indexing) is a separate step run against the same schema.

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
