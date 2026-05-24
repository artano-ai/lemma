# What is a card

A **card** is a typed JSON document describing a single
peer-recognisable building block of scientific knowledge. The
corpus in `cards/` is a curated collection of cards organised by
domain.

Every card validates against the JSON Schema at
[`../schema/card.v0.1.json`](../schema/card.v0.1.json).

## Four kinds

A card is one of four discriminated variants, distinguished by the
`kind` field:

### `principle`

A peer-recognisable scientific law or relation. Carries:

* A canonical formula or set of relations.
* The dimensional structure of every variable.
* Conventions in use (units, sign conventions, coordinate frames).
* Expected asymptotic limits.
* Validation envelopes — concrete input → expected-output pairs that
  the engine can check candidate code against.
* References to the canonical source (textbook, paper).

Example: `cards/physics/classical-mechanics/free-fall-uniform-gravity.json`.

### `ops`

A parameterised template for a computational protocol — a SLURM
batch script, a Snakemake rule, a Singularity recipe. Carries the
parameters the template accepts, defaults that make sense on a given
HPC partition, and the validation envelope that says what a correct
output looks like.

Example: `cards/ops/`.

### `hypothesis`

A proposed extension to the corpus, explicitly marked as
**not yet verified**. Declares the cross-checks the engine must run
to either promote it to a `principle` or reject it. The hypothesis
cross-check engine consumes this kind of card.

Example: `cards/hypotheses/`.

### `unidentified`

A sentinel kind returned by the IDENTIFY phase when no card honestly
matches the request. Surfaced verbatim instead of fabricating a
fallback. Refusing to fabricate is a feature, not a bug — see
[`architecture.md`](./architecture.md) for the rationale.

## The shape of a principle card

```json
{
  "id": "free-fall-uniform-gravity",
  "kind": "principle",
  "domain": "physics-classical-mechanics",
  "title": "Free fall under uniform gravity",
  "summary": "Position of a falling body in uniform gravity g, ignoring drag.",
  "formula": {
    "expression": "y(t) = y0 + v0*t - 0.5*g*t**2",
    "variables": [
      { "symbol": "y0", "dimension": "L", "unit_si": "m" },
      { "symbol": "v0", "dimension": "L/T", "unit_si": "m/s" },
      { "symbol": "g",  "dimension": "L/T^2", "unit_si": "m/s^2" },
      { "symbol": "t",  "dimension": "T", "unit_si": "s" },
      { "symbol": "y",  "dimension": "L", "unit_si": "m" }
    ]
  },
  "limits": [
    { "when": "t = 0", "expect": "y = y0" },
    { "when": "g = 0", "expect": "y = y0 + v0*t" }
  ],
  "validation_envelopes": [
    {
      "inputs":  { "y0": 100, "v0": 0, "g": 9.81, "t": 1 },
      "expected": { "y": 95.095 },
      "tolerance": 1e-3
    }
  ],
  "references": [
    "Goldstein, Classical Mechanics, 3rd ed., Section 1.4"
  ]
}
```

Only `id`, `kind`, and `domain` are strictly required. Everything
else is optional but increases what the engine can verify.

## Why a single shape across domains

The schema is universal. What differs across domains is the
`domain` field and the specific quantities the formula references.
A condensed-matter card and a population-genetics card go through
the same parser, the same validator, the same cross-check engine.

This is on purpose: keeping one schema lets the engine improve once
and benefit every domain.

## See also

* [`schema/card.v0.1.json`](../schema/card.v0.1.json) — the
  authoritative wire format.
* [`contributing-cards.md`](./contributing-cards.md) — how to author
  a new card, with the bronze / silver / gold review tiers.
* [`architecture.md`](./architecture.md) — how the engine consumes
  cards.
