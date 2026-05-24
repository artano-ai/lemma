# Architecture

How the Lemma engine consumes cards and produces verdicts on
candidate code.

## The four phases

A typical Lemma verification flow is built around the **ISEE**
phases:

1. **Identify** — match the user's request against the corpus.
   Return either the cards that apply or, if none honestly match,
   an `unidentified` sentinel.
2. **Set Up** — assemble the parameters and conventions the cards
   require. For a `principle` card this is units, sign conventions,
   and coordinate frames. For an `ops` card this is partition,
   wall-time, node count.
3. **Execute** — run the candidate code (or, in a dry mode, parse
   it without execution).
4. **Evaluate** — score the output against the validation envelopes
   the cards declare. Return a structured verdict.

## Two engines

The engine has two distinct subsystems:

### Universal Scientific Check Engine (USCE)

USCE verifies **finished outputs** against the validation envelopes
the cards declare. Concretely:

* Reads the inputs and the candidate output.
* Evaluates each declared envelope (input → expected-output with a
  tolerance).
* Runs dimensional analysis to confirm units consistent across the
  expression.
* Returns a per-check severity verdict (`ok` / `minor` /
  `major` / `blocker`), not a single scalar.

USCE never asks the model to grade itself. The scoring is
deterministic.

### Hypothesis cross-check engine

The cross-check engine verifies **AI-proposed new cards** (cards of
`kind: hypothesis`). It runs:

* **Dimensional analysis** — every variable's dimension is consistent
  with the formula expression.
* **Reference resolution** — every cited reference resolves to a
  parseable source.
* **Limit-case probing** — declared limits (e.g. `t = 0 → y = y0`)
  are evaluated and compared to the formula's output.
* **`derivedFrom` link resolution** — every other card the
  hypothesis claims to derive from actually exists in the corpus.

A hypothesis that passes all four can be promoted to `principle`
via PR discussion. A hypothesis that fails any is surfaced verbatim
with the failure mode, never silently dropped.

## Universal substrate, wedge-domain corpus

The engine is **domain-agnostic**. The schema is universal; the
checks (dimensional analysis, envelope evaluation, limit probing) do
not embed silicon constants or DFT-specific assumptions. The wedge
domain emphasis in today's corpus (condensed-matter physics,
numerical methods, materials chemistry) is **initial corpus
weighting**, not product scope.

Any group in any domain — chemistry, biology, climate, mathematics,
engineering — can contribute cards from day one without changing
the engine. The engine processes them the same way.

## Refusing to fabricate

When a prompt is outside the corpus or outside an implemented track:

* IDENTIFY runs for real and returns either matching cards or an
  `unidentified` sentinel.
* SET UP / EXECUTE / EVALUATE emit `kind: 'pending'` with an
  explicit reason if the track is not implemented.
* The verdict surface says "no checks — track not yet implemented,
  overall: pending".
* No fabricated code, no fake verdicts, no hallucinated card claims.

This is a feature. Every cycle the engine gets better at being
honest about what it does not know compounds trust. Every cycle it
fabricates kills the trust budget.

## See also

* [`what-is-a-card.md`](./what-is-a-card.md) for the data model the
  engine consumes.
* [`mcp-server.md`](./mcp-server.md) for the MCP surface the engine
  is reached through.
