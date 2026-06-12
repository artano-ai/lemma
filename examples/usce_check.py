#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""
USCE — check a finished output against a card's validation envelopes.

The cross-check engine vets a *proposed* formula. USCE vets a *finished
result*: it range-checks the numbers your code produced against the [min, max]
bounds the card declares (within -> pass, outside -> HIGH). No database, no
API keys.

Run:
    pip install -e ../sdk-py
    python usce_check.py
"""
from artano_lemma import find_card, load_cards, run_usce_checks

corpus = load_cards()
card = find_card("ideal-gas-law", corpus)  # declares gasConstant_J_per_molK in [8.314, 8.315]


def report(label: str, output: dict) -> None:
    result = run_usce_checks(output, card)
    o = result.overall
    print(f"\n{label}: {o.severity}  ({o.passing}/{o.total} checks pass)")
    for check in result.checks:
        print(f"  [{check.severity}] {check.detail}")
    print(f"  -> {result.diagnosis}")


# A correct result: the gas constant the code used is in range.
report("R = 8.3145 (correct)", {"gasConstant_J_per_molK": 8.3145})

# A wrong result: the code used a bad constant -> USCE catches it.
report("R = 9.0 (wrong)", {"gasConstant_J_per_molK": 9.0})
