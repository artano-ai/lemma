# Changelog

All notable changes to `@artano-ai/mcp-server` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/), and the
package adheres to [Semantic Versioning](https://semver.org/).

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
