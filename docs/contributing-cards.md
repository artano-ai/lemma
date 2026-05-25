# Contributing cards

Cards are the heart of Lemma. Most contributions to this repository
are new cards or refinements to existing ones. This guide is the
authoring playbook.

## Where cards live

Cards live in `cards/<domain>/<id>.json`. The domain is part of the
folder structure and also a top-level field on the card itself. The
two must agree.

Examples:

* `cards/physics/classical-mechanics/free-fall-uniform-gravity.json`
* `cards/chemistry/kinetics/arrhenius-rate-law.json`
* `cards/numerical-methods/ode/runge-kutta-4.json`

## Anatomy of a card

See [`what-is-a-card.md`](./what-is-a-card.md) for the full data
model and the JSON Schema reference. The minimum a *principle* card
should ship with:

1. **`id`** — kebab-case, globally unique inside the corpus.
2. **`kind`** — `principle`, `ops`, `hypothesis`, or `unidentified`.
3. **`domain`** — must match the folder path.
4. **`title`** and **`summary`** — a human-readable name and a
   one-paragraph plain-English description.
5. **`formula.expression`** — the canonical form.
6. **`formula.variables`** — each variable with its `dimension` and
   `unit_si`.
7. **`limits`** — at least one asymptotic or boundary check.
8. **`validation_envelopes`** — at least one concrete
   input → expected-output pair with tolerance.
9. **`references`** — at least one canonical source citation.

The engine can verify candidate code more deeply the richer these
fields are.

## Review tiers

The corpus uses a **bronze / silver / gold** maturity tag (stored in
the card's `tier` field).

| Tier | What it means | What the engine does with it |
| --- | --- | --- |
| `bronze` | Newly added by a contributor; basic shape correct; not yet peer-reviewed. | Used in IDENTIFY suggestions; the engine flags responses that lean on it as `bronze-card-warning`. |
| `silver` | Reviewed by at least one project maintainer; formula, dimensions, limits, and at least one validation envelope have been verified by hand. | Engine treats this as a normal card. |
| `gold` | Independently reproduced by a second maintainer; at least three validation envelopes pass automated reproduction in CI. | Engine treats this as a high-confidence card; can be cited in published-work workflows. |

New cards land at `bronze` by default. Promotion happens through PR
discussion + (for `gold`) automated reproduction in CI.

## Workflow for adding a card

1. **Pick a domain folder.** If the folder does not exist yet, create
   it and add a short `README.md` describing the domain.
2. **Copy an existing card** in the closest domain as a template.
3. **Fill in the fields.** Pay particular attention to dimensions,
   limits, and references.
4. **Validate locally:**

   ```sh
   npx ajv-cli validate \
     -s schema/card.v0.1.json \
     -d "cards/**/*.json"
   ```

5. **Open a pull request.** Use the `Card proposal` issue template
   linked from the new-issue page if you want to discuss the
   addition before writing the JSON.

## What makes a *good* card

* Each variable has an explicit SI unit and dimension.
* `limits` includes at least one zero-case (e.g. `v = 0`, `T → 0`)
  and at least one large-parameter case.
* `validation_envelopes` use values that are easy to verify by hand
  (round numbers, textbook examples).
* `references` cites the primary source where the principle was
  derived, not a secondary review.

## What we will not merge

* Cards whose formula uses dimensionally inconsistent expressions.
* Cards whose `references` are blog posts or non-attributable
  sources.
* Cards that duplicate an existing card without explaining why a
  new one is needed.
* Cards in domains that are out of scope for the corpus today
  (consult the maintainers first if unsure).

## See also

* [`what-is-a-card.md`](./what-is-a-card.md) for the data model.
* [`schema/card.v0.1.json`](https://github.com/artano-ai/lemma/blob/main/schema/card.v0.1.json) for the
  authoritative wire format.
* [`CONTRIBUTING.md`](https://github.com/artano-ai/lemma/blob/main/CONTRIBUTING.md) for the general
  contribution flow.
