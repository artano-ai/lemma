# @artano-ai/mcp-server

[Lemma](../cards/README.md)'s MCP server — exposes the open cards corpus and verification engines to any [MCP](https://modelcontextprotocol.io)-compatible client.

The server is the canonical distribution surface for the Lemma substrate. Plug it into claude-code, Cursor, Codex, Gemini Code Assist, or any MCP-aware tool-use runtime and gain access to:

### Cards & verification

- **`cards_list`** — list curated scientific principle cards in the local seed corpus (condensed-matter physics, classical mechanics, chemistry — the corpus is domain-agnostic and grows over time). Optional `domain` substring filter.
- **`cards_get`** — fetch a full card record (PrincipleCard or HypothesisCard) by id. Returns the JSON payload. Refuses to fabricate — unknown ids produce a structured error listing valid ids.
- **`ops_get`** — fetch an OpsCard (SLURM / Snakemake / Singularity recipes) rendered as Markdown for direct LLM consumption.
- **`hypothesis_crosscheck`** — run the hypothesis cross-check engine on a HypothesisCard. Pass either an `id` (existing card) or an inline `card` object (e.g. one freshly proposed by an LLM). Verifies dimensional analysis (real), reference-corpus resolution (real), declared limit / conservation claims (recorded as warnings pending symbolic verification), and `derivedFrom` link resolution. Returns a verdict + diagnosis.

### Scientific computing helpers

- **`rag_lookup`** — retrieves passages from a Postgres + pgvector corpus indexed over the Siesta manual, ASE, pymatgen, numerical methods, SLURM/MareNostrum docs, and any extra source you point it at.
- **`parse_siesta_fdf`** — reads Siesta `.fdf` input files. Handles `%block`/`%endblock`, scalar values with optional units, and Siesta's case-insensitive label convention. Modes: `summary`, `full`, single-label fetch, single-block fetch.
- **`parse_eig_file`** — reads Siesta `.EIG` files. Computes Fermi level, VBM/CBM per spin, bandgap, metallic detection. Optional `kpt=N` dumps one k-point's eigenvalues annotated with E−E_F.
- **`generate_slurm`** — produces a SLURM batch script. Defaults tuned for MareNostrum 5 partitions (`gpp_compute`, `acc_compute`, `*_debug`, `*_bsccs`); valid on any SLURM cluster. Wires `OMP_NUM_THREADS`, `srun --cpu-bind=cores`, and validates partition / GPU consistency.

Tools deliberately omitted: `read_file`, `write_file`, `list_files`, `run_shell`. Every modern tool-use runtime already provides those — this server adds the scientific layer on top.

---

## Install

```sh
pnpm install
pnpm build
```

## Configure

Copy `.env.example` to `.env.local` and fill in at least `ATOMIRA_RAG_DSN`. The other variables have working defaults for local development.

The Postgres database must have the `pgvector` extension enabled and the `chunks` table built. See `artano-code/rag/README.md` in this repository for the bootstrap and indexing scripts (the MCP server reads from the same schema the extension writes to).

## Wire it into a client

Most MCP clients accept a stdio server defined in a JSON config. The exact location of that config depends on the client. The shape is universal:

```json
{
  "mcpServers": {
    "lemma": {
      "command": "node",
      "args": ["/absolute/path/to/repo/mcp-server/dist/index.js"],
      "env": {
        "ATOMIRA_RAG_DSN": "postgresql://you@localhost:5432/atomira_lab",
        "ATOMIRA_WORKSPACE": "/absolute/path/to/your/project"
      }
    }
  }
}
```

Once the client restarts, the tools appear and can be called the same way as any other tool the client exposes.

The cards/hypothesis tools work with no env config — they read from the bundled seed corpus. Only `rag_lookup` needs `ATOMIRA_RAG_DSN`; the others are optional.

## Run from source (dev)

```sh
pnpm dev
```

Speaks MCP over stdio. Connect any MCP client to it (or use the bundled smoke test once it's added).

## Workspace resolution

Tools that take a `path` argument resolve it relative to:

1. `ATOMIRA_WORKSPACE` env var, if set.
2. `process.cwd()` of the server process, otherwise.

Paths must be relative and must not contain `..`. Absolute paths are rejected. This is intentional — the server is meant to be safe to drop into any agent runtime without granting it access outside the configured workspace.

## What this is and isn't

- This server is **infrastructure**. It does not call an LLM, does not maintain conversation state, and does not know which client is calling it. It just exposes tools.
- It is **one of six clients** consuming the same Lemma backend (cards corpus + USCE + cross-check engine). The IDE plugin (`../../artano-code/`), the web companion (`../../artano-researcher/`), the CLI, and the SDK are siblings.
- For the wider Lemma architecture (cards corpus, hypothesis cross-check engine, provenance), see `../cards/README.md` and the JSON Schema at `../schema/card.v0.1.json`.

## License

Apache-2.0.
