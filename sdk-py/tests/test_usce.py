# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Tests for the USCE validation-envelope checker."""

from __future__ import annotations

from artano_lemma import find_card, load_cards, run_usce_checks

CARD = find_card("ideal-gas-law", load_cards())  # envelope: gasConstant_J_per_molK [8.314, 8.315]


def test_within_envelope_passes():
    r = run_usce_checks({"gasConstant_J_per_molK": 8.3145}, CARD)
    assert r.overall.severity == "NONE"
    assert r.checks[0].severity == "pass"


def test_outside_envelope_fails():
    r = run_usce_checks({"gasConstant_J_per_molK": 9.0}, CARD)
    assert r.overall.severity == "HIGH"
    assert r.checks[0].severity == "fail"


def test_no_overlap_checks_nothing():
    r = run_usce_checks({"unrelated": 1.0}, CARD)
    assert r.overall.total == 0
    assert r.overall.severity == "NONE"
