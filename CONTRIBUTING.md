# Contributing to Lemma

Thanks for your interest in Lemma. This guide covers the practical
shape of contributions; for the conduct expectations, see
[`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

## What lives in this repository

| Subdirectory | Purpose | Licence |
| --- | --- | --- |
| `schema/` | JSON Schema 2020-12 for cards. | MIT |
| `cards/` | Curated corpus of principle / ops / hypothesis cards. | CC-BY 4.0 |
| `mcp-server/` | Node MCP server, ships to npm as `@artano-ai/mcp-server`. | Apache-2.0 |
| `sdk-py/` | Python SDK, ships to PyPI as `artano-lemma`. | Apache-2.0 |

Each subdirectory has its own README with deeper context. Start
there if you are touching that area.

## Three kinds of contribution

### 1. Adding or refining a card

Most contributions land here. Cards are JSON files under
`cards/<domain>/<sub-domain>/`, and the `domain` field is that path joined with
a hyphen — `cards/physics/condensed-matter/` means
`"domain": "physics-condensed-matter"`. (`cards/ops/` and `cards/hypotheses/`
are flat and carry no `domain`.) Workflow:

1. Pick a domain folder, copy an existing card as a template.
2. Edit the fields. The schema lives at `schema/card.v0.1.json`.
3. Validate locally, **both checks**:

   ```sh
   npx ajv-cli@5 validate --spec=draft2020 -s schema/card.v0.1.json -d "cards/**/*.json"
   node scripts/check-corpus.mjs
   ```

4. Open a pull request. CI runs both.

**Why two commands.** The first asks *"is this card well-formed?"* and answers it
one file at a time — which is all JSON Schema can do. The second asks the
questions that span files, and they are the ones that bite: a duplicate `id`, a
`domain` that disagrees with its folder, or a reference (`mustAgreeWith`,
`derivedFrom`, `limits[].target.cardId`) pointing at a card that does not exist.
A dangling reference is the nastiest of the three, because the engine resolves it
at runtime and reports it as a *failed check* — so a broken link arrives looking
like a verdict about the science.

If you are testing against a corpus other than this repo's, set
`LEMMA_CARDS_DIR` and confirm with `lemma paths` which one actually resolved.

See the [card concepts](https://docs.openlemma.dev/concepts/cards/) and the
[card-authoring guide](https://docs.openlemma.dev/guides/authoring-a-card/) at
docs.openlemma.dev for the full walkthrough, including the bronze / silver /
gold review tiers.

### 2. Working on the MCP server

The MCP server lives in `mcp-server/`. To set up:

```sh
cd mcp-server
pnpm install
pnpm typecheck
pnpm build
```

The server reads cards from `../cards/` at runtime.

### 3. Working on the Python SDK

The SDK lives in `sdk-py/`. To set up:

```sh
cd sdk-py
pip install -e ".[dev]"
pytest
ruff check .
mypy .
```

## Pull request guidelines

- Small, focused PRs land faster than large ones. If you are
  changing more than ~300 lines, consider splitting.
- Add or update tests where it makes sense.
- Update any docs touched by the change.
- Commit messages: short imperative subject line; a body explaining
  *why* if the diff alone is not self-explanatory. No reference to AI
  tooling, automated assistants, or any tool used to author the
  change.
- New cards: include `references[]` pointing at the canonical source
  (textbook, paper, official documentation).

## Code style

- TypeScript: `pnpm typecheck` must pass; no `any` without comment.
- Python: `ruff check .` and `mypy .` must pass.
- JSON cards: must validate against `schema/card.v0.1.json`.

## Licensing of contributions

By submitting a contribution to this repository you agree that:

* code contributions are licensed under **Apache-2.0**,
* card content contributions are licensed under **CC-BY 4.0**,
* schema contributions are licensed under **MIT**,

matching the licence of the subdirectory the contribution lands in.
