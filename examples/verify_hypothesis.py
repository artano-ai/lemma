#!/usr/bin/env python3
"""
Lemma cross-check engine — runnable example.

Shows the hypothesis cross-check engine *accepting* a well-formed proposed
principle and *rejecting* a dimensionally-inconsistent one. No database and
no API keys: it reads the bundled cards corpus and runs the engine in
process.

Run:
    pip install -e ../sdk-py
    python verify_hypothesis.py
"""
from artano_lemma import load_cards, parse_card, run_hypothesis_checks

CORPUS = load_cards()


def report(label: str, card_dict: dict) -> None:
    card = parse_card(card_dict)
    result = run_hypothesis_checks(card, corpus=CORPUS)
    overall = result.overall
    print(f"\n{label}")
    print(f"  verdict: {overall.severity}  ({overall.passing}/{overall.total} checks pass)")
    for check in result.checks:
        print(f"    [{check.severity:>4}] {check.name}")
    print(f"  → {result.diagnosis}")


print(f"Loaded {len(CORPUS)} cards from the bundled corpus.")

# 1) A well-formed proposal: a planet's radiative-equilibrium temperature,
#    extending the Stefan-Boltzmann card. Both sides are a temperature, the
#    referenced card resolves -> the engine accepts it. Limit / conservation
#    claims stay as warnings pending symbolic verification.
report(
    "Well-formed hypothesis — planetary radiative-equilibrium temperature:",
    {
        "kind": "hypothesis",
        "id": "candidate-equilibrium-temperature",
        "version": "0.1.0",
        "name": "Planetary radiative-equilibrium temperature",
        "proposal": "T_eq = ((1 - albedo) S / (4 sigma))^(1/4) from radiative balance",
        "proposedFormulaTeX": r"T_{eq} = \left(\frac{(1-\alpha) S}{4\sigma}\right)^{1/4}",
        "origin": "llm",
        "derivedFrom": {
            "cardId": "stefan-boltzmann-radiation",
            "relationship": "extends",
        },
        "references": ["Hartmann, Global Physical Climatology, ch.2"],
        "checks": {
            "dimensional": {
                "lhsLabel": "T_eq [K]",
                "lhsDims": {"Theta": 1},
                "rhsLabel": "((1-a)S / 4 sigma)^(1/4) [K]",
                "rhsDims": {"Theta": 1},
            },
            "referenceCorpus": {"mustAgreeWith": ["stefan-boltzmann-radiation"]},
        },
    },
)

# 2) A broken proposal: kinetic energy written as E = m v. Energy is
#    [M L^2 T^-2] but m v is [M L T^-1] -- the engine catches the mismatch
#    and returns HIGH severity, so a bad proposal is rejected before any
#    human ever reviews it.
report(
    "Broken hypothesis — E = m v (dimensionally inconsistent):",
    {
        "kind": "hypothesis",
        "id": "broken-kinetic-energy",
        "version": "0.1.0",
        "name": "Kinetic energy (incorrect)",
        "proposal": "E = m v",
        "proposedFormulaTeX": "E = m v",
        "origin": "llm",
        "references": ["none"],
        "checks": {
            "dimensional": {
                "lhsLabel": "E [J]",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "m v",
                "rhsDims": {"M": 1, "L": 1, "T": -1},
            },
        },
    },
)
