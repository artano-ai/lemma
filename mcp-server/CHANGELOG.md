# Changelog

All notable changes to `@artano-ai/mcp-server` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/), and the
package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Two new checkers, both cross-language.** `runSeriesChecks` verifies declared
  sign and bound conditions across a reported series; `runConvergenceCheck`
  recomputes an order of accuracy from its refinement study instead of trusting
  a reported number. Neither is an MCP tool yet — both are on the engine entry
  point and on `lemma verify`.
  - The series check reaches cards the envelope check structurally cannot: a
    density of states has no system-independent magnitude, so those cards
    deliberately declare no `validationEnvelopes`, but `g(epsilon) >= 0` holds
    in every material at any k-mesh under any smearing.
  - The convergence check refuses rather than misattributes: a study containing
    round-off-limited levels fits a shallower slope, which is a contaminated
    measurement rather than a wrong method, so it warns with the per-level
    orders attached instead of failing.
- `seriesConditions` and `convergence` on `PrincipleCard`, so both checks read
  what they need from the corpus rather than from every caller.

- **`lemma-rag` — the ingestion half of RAG.** `rag_lookup` could search an
  index but nothing could build one: there was no table DDL in the repo, so the
  schema was discoverable only by reading the `SELECT` in `search.ts`, and
  `embedDocument` was implemented on both embedders and called from nowhere. New
  commands: `init`, `ingest`, `status`, `forget`. Chunking splits on paragraph
  and sentence boundaries with overlap, and ingest **upserts** on
  `(source, content_key)` so re-ingesting a document replaces rather than
  duplicates — a silent duplication would skew retrieval toward whatever was
  ingested most often. The raw DDL is at `src/rag/schema.sql`.
- The vector column is sized from the **configured embedder** (768 for the
  default local model, 3072 for `gemini-embedding-001`), and a mismatch against
  an existing table is refused with an explanation instead of failing later on a
  Postgres type error that never mentions the embedding model.
- `formula`, the four machine limit forms (`limit`, `substitute`, `solveFor`,
  `fixedPoint`), `target` and `evolution` added to the card types. These had
  been in the JSON Schema and the Python models for weeks; the TypeScript types
  are a hand-maintained projection and had silently fallen behind. Runtime
  output was unaffected — TypeScript types are erased, so both engines kept
  emitting identical JSON — which is exactly why nothing caught it. A CI check
  (`scripts/check-corpus.mjs`) now guards the projection.
- `CARDS_DIR` is exported from `@artano-ai/mcp-server/engine`, matching the
  Python SDK. Consumers previously had no authoritative way to report which
  corpus resolved.

### Changed

- **`rag_lookup`'s description no longer names sources it cannot supply.** It
  advertised passages from "the Siesta manual, ASE, pymatgen, numerical methods,
  HPC docs" — none of which ship with this package. It now states that the index
  is self-hosted and that nothing is bundled, and the empty-result message
  distinguishes "the index is empty" from "there is no answer".
- `ConservationLawSpec.law` is a free-form string rather than a closed union of
  six physics values. The enum forced a population-dynamics card to declare
  `law: "energy"` for a Lyapunov function, so its own statement opened "No
  conserved energy-like quantity". Conventional values are exported as
  `CONVENTIONAL_CONSERVATION_LAWS`.

## [0.1.1]

- Add a public engine entry point: `@artano-ai/mcp-server/engine` re-exports the
  cards corpus and the verification engines (`runHypothesisChecks`,
  `runUsceChecks`, the cards, the dimensional helpers, and the card types), so
  reference clients can consume the engine without the MCP server.

## [0.1.0]

Initial release. Exposes the Lemma verification substrate over the Model
Context Protocol with six tools:

- `cards_list` — list the curated scientific cards corpus
- `cards_get` — fetch a full card record by id
- `ops_get` — fetch an ops card rendered as Markdown
- `hypothesis_crosscheck` — run the cross-check engine on a hypothesis card
- `usce_check` — validate a finished output against a card's validation envelopes
- `rag_lookup` — retrieve passages from a pgvector corpus

The cards corpus is bundled into the package, so it works standalone.
