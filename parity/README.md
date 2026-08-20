# Cross-language parity fixture

The Lemma engine ships **twice**:

| | implementation | tests |
|---|---|---|
| TypeScript | `mcp-server/src/cards/` | `mcp-server/test/parity.test.ts` |
| Python | `sdk-py/artano_lemma/engine.py` | `sdk-py/tests/test_parity.py` |

Both are contracted to return **byte-identical verdicts and byte-identical
prose**, so a consumer that diffs results across the two implementations sees
zero noise. `engine.py` states that contract in its module docstring.

Nothing enforced it before this fixture existed. Each suite tested its own
language against its own output, so the two could drift apart while both stayed
green — which is exactly what happened. Three real divergences were shipping or
about to ship:

| where | TypeScript | Python |
|---|---|---|
| `usce` detail + diagnosis | `-- the output violates…` | `— the output violates…` |
| `usce` numbers | `= 99 is outside [8, 9]` | `= 99.0 is outside [8.0, 9.0]` |
| `agreement` refusal | `got 1 (madar)` | `got 1 (['madar'])` |

The number one only surfaces on **whole** values, which is why it survived:
`9.81` in `[9.7, 9.9]` renders identically in both languages. Real envelopes are
often round (the corpus has `deltaGauge_meV_per_atom: [0.0, 2.0]`), so it was
live.

## Two layers, guarded two different ways

| layer | what ships twice | guarded by | style |
|---|---|---|---|
| **engine** | `run_usce_checks`, `run_hypothesis_checks`, `run_agreement_checks` | `cases.json` + `parity.test.ts` / `test_parity.py` | golden text |
| **tool surface** | `cards_list`, `cards_get`, `ops_get`, `hypothesis_crosscheck` | `tool-surface.test.ts` / `test_tool_surface.py` | invariants |

The split is deliberate. Engine cases use **synthetic** fixture cards, so golden
text is stable — editing a real card can never break them. The tool surface
renders the **live corpus**, so golden text there would break on every card
edit and train whoever hits it to regenerate reflexively, which is the exact
habit this file warns against below. Invariants stay true as the corpus grows.

The tool layer was added after two divergences shipped there unnoticed, both
found by hand rather than by a test:

- **Metadata leak.** `cards_get` was documented in two planning docs as
  stripping `metadata` "verified across all MCP tools". It did in TypeScript
  and did not in Python, so `artano-lemma` sent author names and ORCIDs to the
  model provider on every call.
- **Escaped JSON.** `hypothesis_crosscheck` embeds the raw verdict as JSON.
  `JSON.stringify` emits literal UTF-8; Python's `json.dumps` escapes
  non-ASCII by default, so every dimension separator, em dash and empty-set
  glyph came out as a `\uXXXX` escape in Python where Node showed the symbol.

Note that `usce_check` and `rag_lookup` exist only in TypeScript, so they have
no parity obligation. If either gains a Python counterpart, add it to both
tool-surface files.

## Recorded exclusion — symbolic discharge (Python-only)

`artano_lemma.symbolic` discharges declared claims with SymPy — limits,
substitutions, roots, fixed points of coupled systems, and the rate at which a
declared quantity evolves. **It has no Node counterpart and will not get one** —
there is no comparable computer-algebra system in that ecosystem. It is the first
deliberate divergence between the two implementations, so it is written down
rather than left to be discovered.

Parity is preserved by construction: the feature is **opt-in and off by default**
(`run_hypothesis_checks(..., symbolic=True)`), and **no case in `cases.json`
enables it**. With the flag off both engines take the identical
recorded-claim path, which is why the fixture still diffs byte-identical with
SymPy installed.

**The rule for anyone extending this:** the symbolic path must never become the
default and must never be reachable from a parity case. If it leaks into the
default path the two engines diverge silently — precisely the failure this
fixture exists to prevent, and it would be invisible because both suites would
still pass on their own.

If one of these claims must be checked in both languages, the answer is to move the
check into the *card* (a declarative form both engines can evaluate), not to
find a JavaScript CAS.

## How it works

`cases.json` holds inputs plus a golden `expected` for every case. Each language
loads the same file, runs its own engine, and asserts equality. A drift in
either language fails **that language's own CI job** — which matters, because no
CI job installs both runtimes.

Cases cover all three engine entry points (`run_usce_checks`,
`run_hypothesis_checks`, `run_agreement_checks`), including the sharp edges:
the anti-silent-pass `requireChecks` path, non-gating observables, nothing
comparable, whole-number rendering on both the pass and fail branches, and the
refusal message when a single method tries to corroborate itself.

The fixture cards are synthetic and self-contained. This tests **engine parity,
not corpus contents**, so editing a real card must never break it.

## Regenerating after an intentional wording change

**Never regenerate from one language.** The golden is what makes drift visible;
regenerating from a single side blesses whichever side is wrong, which is the
precise failure this fixture exists to prevent.

The procedure is: run both engines over `cases.json`, **diff them**, and only
write the golden if they already agree. If they disagree, that is a finding —
fix the engines first, then regenerate.

1. Change the wording in **both** implementations.
2. Run each engine over every case and dump the results.
3. `diff` the two dumps. **They must be identical.**
4. Only then write the results into `cases.json` as `expected`.
5. Run both suites, and review the `cases.json` diff before committing — the
   changed strings should be exactly the ones you intended and nothing else.

## Adding a case

Append to `cases.json` with `id`, `fn` (`usce` | `hypothesis` | `agreement`),
and `input`; then regenerate `expected` per above. Cards can be shared between
cases by reference (`{"$use": "agreementCard"}` resolving against the `shared`
block) so one card cannot drift between cases.

When adding a case meant to guard a *formatting* rule, make sure the values
actually exercise it. A whole-number rule needs a whole number: the pass-branch
case originally used `9.81`, and a deliberate regression proved it caught
nothing until a whole-number case was added.
