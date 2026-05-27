# HumanEval-Sci — Node / TypeScript runner

Node / TypeScript implementation of the HumanEval-Sci evaluation
harness. Parallel to [`../python/`](../python/), and intentionally
shares:

- `../../prompts/` — the 73 prompt JSONs
- `../../results/` — leaderboard / per-run output JSONs
- `../../README.md` — the canonical benchmark description

A run produced by either runner lands in the same `results/` folder.

## Install

```bash
cd runners/node
pnpm install
```

## Commands

```bash
pnpm typecheck             # tsc --noEmit
pnpm smoke                 # reference adapter over every prompt (no API calls)
pnpm smoke-ab              # A/B run two adapters (needs ../../.env.local)
pnpm test-differential     # differential scorer sanity check
pnpm test-stats            # statistical helper checks
```

The `tsx` runner expects the cwd to be `runners/node/`; scripts
themselves resolve `prompts/` and `results/` relative to their own
location (three levels up to `humaneval-sci/`).

## Layout

```
runners/node/
├── package.json           @artano-ai/humaneval-sci-runner-node
├── tsconfig.json
├── runner/                Evaluation loop + model adapters
├── scorer/                Functional + cross-check verification scorers
└── scripts/               smoke / A-B / differential / N-sweep / etc.
```
