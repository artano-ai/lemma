#!/usr/bin/env python3
"""
Formula-derived dimensional analysis.

The cross-check engine can derive a proposal's dimensions from the formula
itself — a plain-ASCII `expr` plus per-symbol `symbols` — instead of only
comparing the two declared vectors. That catches a proposal that *declares*
the right dimensions but whose *formula* doesn't have them.

No database, no API keys.

Run:
    pip install -e ../sdk-py
    python derive_dimensions.py
"""
from artano_lemma import load_cards, parse_card, run_hypothesis_checks

CORPUS = load_cards()

base = {
    "kind": "hypothesis",
    "version": "0.1.0",
    "origin": "llm",
    "references": ["Goldstein, Classical Mechanics"],
}


def report(label: str, card_dict: dict) -> None:
    result = run_hypothesis_checks(parse_card(card_dict), corpus=CORPUS)
    check = next(c for c in result.checks if c.name == "Hypothesis.dimensional_analysis")
    print(f"\n{label}")
    print(f"  {check.severity}: {check.detail}")


# 1) Sound proposal. The engine PARSES "(1/2)*m*v**2", substitutes the symbol
#    dims, and derives M·L²·T⁻² = energy → pass (the formula itself is checked).
report("E = ½mv²  (derived from the formula):", {
    **base, "id": "kinetic-energy", "name": "Kinetic energy",
    "proposal": "E = (1/2) m v^2", "proposedFormulaTeX": r"E=\tfrac12 m v^2",
    "checks": {"dimensional": {
        "lhsLabel": "E", "lhsDims": {"M": 1, "L": 2, "T": -2},
        "rhsLabel": "(1/2) m v^2", "rhsDims": {"M": 1, "L": 2, "T": -2},
        "expr": "(1/2)*m*v**2",
        "symbols": {"m": {"M": 1}, "v": {"L": 1, "T": -1}},
    }},
})

# 2) The blind spot a declared-only check MISSES: this card *declares* energy
#    on both sides, but its formula is m·v (really M·L·T⁻¹). Deriving from the
#    formula catches it → fail.
report("E = m v  (declares energy, but the formula doesn't have it):", {
    **base, "id": "wrong-energy", "name": "Mis-stated energy",
    "proposal": "E = m v", "proposedFormulaTeX": "E = m v",
    "checks": {"dimensional": {
        "lhsLabel": "E", "lhsDims": {"M": 1, "L": 2, "T": -2},
        # declared (incorrectly) as energy — the old check would trust this:
        "rhsLabel": "m v", "rhsDims": {"M": 1, "L": 2, "T": -2},
        "expr": "m*v",
        "symbols": {"m": {"M": 1}, "v": {"L": 1, "T": -1}},
    }},
})
