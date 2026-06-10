# HumanEval-Sci — evaluation harness

A reference client for the HumanEval-Sci benchmark, in TypeScript. It
drives each prompt through a model adapter, scores the output for
functional correctness, and cross-checks it against the Lemma engine,
then writes a run record. It imports the cross-check engine from the
MCP server in this repo — it *measures* the engine, it does not contain
a copy of it.

It is a consumer of two external inputs and is not pinned to a fixed
layout:

- **Cards corpus** — the engine reads it. `LEMMA_CARDS_DIR` points at a
  card tree; the package scripts default it to `../../cards` (this
  repo's corpus).
- **Benchmark prompts** — distributed separately. Set
  `HUMANEVAL_SCI_PROMPTS_DIR` to the prompt set; the scripts fail with a
  hint if it is unset.

Run output is written to a local `results/` directory; promote notable
runs to the benchmark's landmark set by hand.

## Install

```bash
pnpm install
```

## Commands

```bash
pnpm build                  # tsc
pnpm typecheck              # tsc --noEmit
pnpm smoke                  # reference adapter over every prompt (no API calls)
pnpm smoke-ab               # A/B run two adapters (reads .env.local for API keys)
pnpm best-of-n-rerank       # best-of-N sampling-time rerank
pnpm test-differential      # differential scorer sanity check
pnpm test-crosscheck-tool   # cross-check tool sanity check
pnpm test-stats             # statistical helper checks
```

The scripts set `LEMMA_CARDS_DIR=../../cards`; supply the prompts
directory yourself, e.g.

```bash
HUMANEVAL_SCI_PROMPTS_DIR=/path/to/prompts pnpm smoke
```

## Layout

```
.
├── package.json
├── tsconfig.json
├── runner/    evaluation loop, model adapters, path resolution
├── scorer/    functional + cross-check verification scorers
└── scripts/   smoke / A-B / best-of-N / differential / stats
```
