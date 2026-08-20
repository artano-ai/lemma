# `@artano-ai/cli`

The Lemma command line. Verify a finished result against a card's declared
bounds, cross-check a proposed principle before you open a pull request, and
browse the open cards corpus.

Apache-2.0.

```bash
npm install -g @artano-ai/cli
# or, without installing:
npx @artano-ai/cli cards list
```

## Why a CLI

The engine was already reachable from Python, from Node, and over MCP — but not
from a shell. That left out the one place a verification gate earns its keep: a
CI pipeline, where a wrong number should fail a build without a human reading
anything.

## Verify a finished output

```bash
lemma verify free-fall-uniform-gravity --output '{"gEarth_m_per_s2": 9.81}'
```

```
USCE · free-fall-uniform-gravity · Free fall in uniform gravity (no air resistance)
  pass  gEarth_m_per_s2 = 9.81 is within [9.79, 9.83].
— 1 of 1 checks passed · severity NONE
All checked values fall within the card's validation envelopes.
```

Read the output from a file or a pipe instead:

```bash
lemma verify ideal-gas-law --output-file results.json
my-simulation | jq '{gasConstant_J_per_molK: .R}' | lemma verify ideal-gas-law --output-file -
```

### Exit codes are the point

| Code | Meaning |
| --- | --- |
| `0` | checked, and it passed |
| `1` | checked, and a value is out of range |
| `2` | could not check at all — bad card id, unreadable input, bad usage |

The `1` / `2` split is deliberate. "The physics is wrong" and "you typed the
card id wrong" are both non-zero, but a pipeline that renders them as the same
red build teaches people to ignore the red build.

### An absent check is not a passing one

By default, an output key with no declared envelope is simply not checked — so
a run can exit `0` having verified nothing at all:

```bash
$ lemma verify free-fall-uniform-gravity --output '{"someOtherKey": 1.0}'
— 0 of 0 checks passed · severity NONE
No validation envelopes overlapped the provided output keys — nothing to check.
```

`--require-checks` turns that silence into a failure:

```bash
$ lemma verify free-fall-uniform-gravity --output '{"someOtherKey": 1.0}' --require-checks
— 0 of 0 checks passed · severity HIGH   # exit 1
```

Use it in CI. It is not the default because flipping it would change what every
existing green build means.

## Cross-check a proposed principle

Against a card already in the corpus:

```bash
lemma crosscheck free-fall-with-linear-drag
```

Or against a draft you are writing, which is where this is most useful — a
dimensionally broken card is far cheaper to catch here than in review:

```bash
lemma crosscheck ./my-new-card.json
cat my-new-card.json | lemma crosscheck -
```

```
  fail  Dimensional mismatch — the formula (1/2) m v [J] derives to L·T^-1·M,
        but LHS [E [J]] is L^2·T^-2·M. The proposed equation does not hold
        dimensionally.
```

A `warn` does **not** fail the build. It means the engine declined to answer —
the claim is recorded, neither proven nor refuted. Failing on it would punish
authors for writing down claims the engine cannot yet check, which is backwards:
the corpus wants those claims written down.

## Browse the corpus

```bash
lemma cards list                          # every card
lemma cards list --kind hypothesis        # filter by kind
lemma cards list --domain physics         # filter by domain prefix
lemma cards show density-of-states
lemma cards search entropy
lemma paths                               # where the corpus resolved from
```

`search` is substring matching over ids, names, domains and principles. It is
not semantic search — that is `rag_lookup` on the
[MCP server](https://www.npmjs.com/package/@artano-ai/mcp-server), which needs a
vector index.

`lemma list` and `lemma show` also work as bare aliases, matching the Python
CLI.

## Scripting

`--json` emits machine-readable output and disables colour:

```bash
lemma verify ideal-gas-law --output-file out.json --json | jq '.overall.severity'
lemma cards list --kind principle --json | jq -r '.[].id'
```

Colour is off automatically when stdout is not a TTY, and honours `NO_COLOR`.

## Two runtimes, one binary name

`artano-lemma` on PyPI installs a `lemma` command too. That is intended — they
are the same tool over the same corpus and the same engine contract, so install
whichever runtime you already have. Where the two overlap the commands are
spelled the same.

The one deliberate difference: **symbolic verification is Python-only.** There
is no comparable computer-algebra system in the Node ecosystem, so
`run_hypothesis_checks(..., symbolic=True)` has no counterpart here. Everything
else is held to byte-identical output by a shared fixture.

## Pointing at a different corpus

`LEMMA_CARDS_DIR` overrides where cards are read from — a private fork, or a
card you are drafting:

```bash
LEMMA_CARDS_DIR=./my-cards lemma cards list
```

`lemma paths` reports which corpus actually resolved, which is worth checking
before you trust a verdict.

## Links

- Docs — <https://openlemma.dev>
- Corpus, schema, and engines — <https://github.com/artano-ai/lemma>
