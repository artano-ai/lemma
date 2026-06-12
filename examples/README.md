# Examples

Runnable demos of the Lemma substrate. Each is a single Python file using the
SDK against the **bundled cards corpus** — no database and no API keys (except
`verify_llm_output.py`, which needs a model endpoint).

```sh
pip install -e ../sdk-py      # once
python verify_hypothesis.py   # then run any example below
```

| Example | Layer it shows | What it does |
|---|---|---|
| [`verify_hypothesis.py`](verify_hypothesis.py) | cross-check **engine** | Runs a well-formed and a dimensionally-broken hypothesis → `NONE` vs `HIGH` |
| [`derive_dimensions.py`](derive_dimensions.py) | **formula-derived** dims | Engine derives dims from the formula (`expr` + `symbols`); catches "declares energy but the formula is m·v" |
| [`usce_check.py`](usce_check.py) | **finished-output** check (USCE) | Range-check a finished result's numbers against a card's validation envelopes |
| [`browse_cards.py`](browse_cards.py) | **corpus** access | Load, count, filter, and read cards from the corpus |
| [`validate_card.py`](validate_card.py) | **schema** validation | Parse a good card; reject a malformed one with structured errors |
| [`use_mcp_tools.py`](use_mcp_tools.py) | the **MCP tool** surface | Call `cards_list` / `cards_get` / `ops_get` / `hypothesis_crosscheck` as plain functions |
| [`verify_llm_output.py`](verify_llm_output.py) | **LLM in the loop** | Ask a model (Ollama / any OpenAI-compatible endpoint) to propose a law, then verify its output |

## `verify_hypothesis.py`

The headline capability: the engine accepts a sound proposed principle and
rejects a dimensionally-inconsistent one.

```
Well-formed hypothesis …  verdict: NONE  (3/3 checks pass)
Broken hypothesis (E = m v) …  verdict: HIGH  (0/1 checks pass)  [fail] dimensional_analysis
```

`E = m v` is caught purely on dimensions — energy is `M·L²·T⁻²`, `m v` is
`M·L·T⁻¹` — so a physically-wrong proposal never reaches a human reviewer.

## `derive_dimensions.py`

The dimensional check can **derive** a proposal's dimensions from the formula
(`expr` + `symbols`) rather than only comparing the declared vectors — so it
catches a card that declares energy on both sides but whose formula is `m·v`:

```
E = ½mv²  →  pass   (Derived from formula: … = M·L²·T⁻² matches LHS [E])
E = m v   →  fail   (the formula m v derives to M·L·T⁻¹, but LHS [E] is M·L²·T⁻²)
```

## `browse_cards.py`

Corpus access — `load_cards`, `domains`, `filter_cards`, `find_card` — and
prints one card's formula, conventions, and expected limits.

## `validate_card.py`

Layer 1: is the card *shaped* right? A valid payload `parse_card`s; an invalid
one raises `CardValidationError` listing each schema violation. Same check the
`ajv-cli` command runs, in process.

## `use_mcp_tools.py`

The four corpus/verification tools an MCP client calls — invoked directly as
Python functions, each returning a ready-to-read string.

## `verify_llm_output.py` — use Llama (or any model) to test the verification

The full loop: ask a model to *propose* a principle, then run Lemma's engine on
the model's own output. Needs a model endpoint — local Ollama by default, or any
OpenAI-compatible API.

```sh
ollama serve &            # have Ollama running
ollama pull llama3.1:8b   # (or any model)
python verify_llm_output.py
```

Point it elsewhere with env vars:

```sh
LEMMA_LLM_BASE_URL=https://api.example.com/v1 \
LEMMA_LLM_API_KEY=sk-… \
LEMMA_LLM_MODEL=meta-llama/Meta-Llama-3.1-70B-Instruct \
  python verify_llm_output.py
```

A dimensionally-sound proposal gets `NONE`; `E = m v`, non-JSON, or a
schema-invalid card is rejected — each failure mode is part of the demo.

For a full **A/B benchmark** of a model (control vs treatment over many prompts),
use the eval harness instead: `../eval/humaneval-sci/` → `pnpm smoke-ab --ollama --model llama3.1:8b`.

## Other surfaces (not Python examples here)

- **`rag_lookup`** — needs a Postgres + pgvector backend; see [`../mcp-server/README.md`](../mcp-server/README.md).
- **MCP server over stdio** — `cd ../mcp-server && pnpm dev`, then wire it into an MCP client (Claude Code, Cursor, …).
- **The `lemma` CLI** (after `pip install -e ../sdk-py`): `lemma list`, `lemma show arrhenius-rate-law`, `lemma paths`.

## Validate the whole corpus (no Python)

From the repo root:

```sh
npx ajv-cli@5 validate --spec=draft2020 -s schema/card.v0.1.json -d "cards/**/*.json"
```
