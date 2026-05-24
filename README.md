# Lemma

Open verification infrastructure for AI-driven scientific computing.

Lemma is the substrate: an open card corpus, a JSON Schema, generic
verification engines (USCE + cross-check), and a distribution surface
(MCP server, CLI, SDK) consumed by any AI runtime.

## Layout

```
lemma/
├── schema/              JSON Schema 2020-12 — `card.v0.1.json` (MIT)
├── cards/               Curated card corpus (CC-BY 4.0)
│   ├── physics/
│   ├── engineering/
│   ├── chemistry/
│   ├── biology/
│   ├── climate/
│   ├── mathematics/
│   ├── numerical-methods/
│   ├── ops/
│   └── hypotheses/
├── mcp-server/          Node MCP server — @artano-ai/mcp-server (Apache-2.0)
└── sdk-py/              Python SDK — artano-lemma (Apache-2.0)
```

The schema and the cards corpus are shared across every distribution
surface. Two clients are bundled: a Node MCP server for agent runtimes
that speak the Model Context Protocol, and a Python SDK for
notebook-first scientific workflows that prefer to call Lemma
in-process.

## Card variants

A card is one of four discriminated variants on `kind`:

- **`principle`** — curated, peer-recognisable scientific principle.
  Carries a canonical formula, conventions, expected asymptotic limits,
  references, and optional numerical validation envelopes.
- **`ops`** — parameterised template for a scripting / job-submission
  task (SLURM, Snakemake, Singularity recipes).
- **`hypothesis`** — proposed extension to the corpus, explicitly marked
  unverified; declares the cross-checks the engine must run.
- **`unidentified`** — sentinel returned by the IDENTIFY phase when no
  card honestly matches the request. Surfaced verbatim instead of
  fabricating a fallback.

## Validate any card

```sh
npx ajv-cli validate \
  -s lemma/schema/card.v0.1.json \
  -d "lemma/cards/**/*.json"
```

## Licensing

| Component | Licence |
|-----------|---------|
| `schema/` | MIT |
| `cards/` | CC-BY 4.0 |
| `mcp-server/` | Apache-2.0 |
| `sdk-py/` | Apache-2.0 |

## Stewardship

Stewarded by Atomira Technologies, S.L. (Barcelona).
