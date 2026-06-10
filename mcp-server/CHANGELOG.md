# Changelog

All notable changes to `@artano-ai/mcp-server` are documented here. The
format follows [Keep a Changelog](https://keepachangelog.com/), and the
package adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

Initial release. Exposes the Lemma verification substrate over the Model
Context Protocol with five tools:

- `cards_list` — list the curated scientific cards corpus
- `cards_get` — fetch a full card record by id
- `ops_get` — fetch an ops card rendered as Markdown
- `hypothesis_crosscheck` — run the cross-check engine on a hypothesis card
- `rag_lookup` — retrieve passages from a pgvector corpus
