# Getting started

Five minutes to your first Lemma verification.

## What you get

Lemma is three things bundled in one repository:

* **A cards corpus** — a typed JSON corpus of physics, chemistry,
  biology, climate, mathematics, engineering, and numerical-method
  principles. Each card declares dimensional structure, limit cases,
  validation envelopes, and references.
* **An MCP server** — `@artano-ai/mcp-server`, a Node Model Context
  Protocol server that exposes the corpus and the verification engine
  to any MCP-aware runtime (Claude Code, Cursor, Codex, Goose, …).
* **A Python SDK** — `artano-lemma`, a notebook-first way to read the
  corpus and call the engine in-process.

## Try the MCP server

```sh
npx @artano-ai/mcp-server
```

That starts the server over stdio. Most users wire it into their
agent runtime instead of running it directly — see
[`mcp-server.md`](./mcp-server.md) for Claude Code, Cursor, and Codex
configuration snippets.

## Try the Python SDK

```sh
pip install artano-lemma
lemma paths        # show where the corpus and schema resolve
lemma list         # list every card
lemma show free-fall-uniform-gravity   # pretty-print one card
```

## Inspect the corpus directly

The corpus lives in `cards/` as plain JSON. Browse it on GitHub, or
clone the repo and read the files. The schema at
`schema/card.v0.1.json` defines the shape every card must follow.

## Validate a card

```sh
npx ajv-cli validate \
  -s schema/card.v0.1.json \
  -d "cards/**/*.json"
```

This is also what CI runs on every pull request.

## Next steps

* Read [`what-is-a-card.md`](./what-is-a-card.md) to understand the
  data model.
* If you are integrating Lemma into an agent, read
  [`mcp-server.md`](./mcp-server.md).
* If you are using Lemma from a Python notebook, read
  [`sdk-py.md`](./sdk-py.md).
* If you want to add a card, read
  [`contributing-cards.md`](./contributing-cards.md).
