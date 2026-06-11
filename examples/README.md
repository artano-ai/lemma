# Examples

Runnable, dependency-light demos of the Lemma substrate.

## `verify_hypothesis.py` — the cross-check engine in action

Runs the hypothesis cross-check engine on two proposed principles — one
well-formed, one dimensionally broken — and prints the verdicts. No
database, no API keys; it reads the bundled cards corpus in process.

```sh
pip install -e ../sdk-py
python verify_hypothesis.py
```

Expected output:

```
Loaded 38 cards from the bundled corpus.

Well-formed hypothesis — planetary radiative-equilibrium temperature:
  verdict: NONE  (3/3 checks pass)
    [pass] Hypothesis.dimensional_analysis
    [pass] Hypothesis.reference_corpus
    [pass] Hypothesis.derived_from
  → All declared cross-checks pass. ...

Broken hypothesis — E = m v (dimensionally inconsistent):
  verdict: HIGH  (0/1 checks pass)
    [fail] Hypothesis.dimensional_analysis
  → Hypothesis fails one or more hard cross-checks. ...
```

The broken proposal (`E = m v`) is rejected purely on dimensions — energy
is `M·L²·T⁻²` while `m v` is `M·L·T⁻¹` — so it never reaches a human
reviewer. That is the substrate's job: catch the physically-wrong output
that passes a syntax check.

## Validate the cards corpus

Every card is schema-validated. From the repo root:

```sh
npx ajv-cli@5 validate --spec=draft2020 -s schema/card.v0.1.json -d "cards/**/*.json"
```
