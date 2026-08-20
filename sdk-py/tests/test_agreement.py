# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Tests for the cross-method agreement checker."""

from __future__ import annotations

import pytest

from artano_lemma import PrincipleCard, run_agreement_checks

CARD = PrincipleCard(
    kind="principle",
    id="test-agreement",
    version="1.0.0",
    name="test",
    principles=["p"],
    formulaTeX="x",
    conventions=["c"],
    expectedLimits=["l"],
    references=["r"],
    crossMethodTolerances={
        "latticeConstant_A": {"relative": 0.01},
        "indirectGap_eV": {"absolute": 0.05},
        "bulkModulus_GPa": {"absolute": 25.0, "gating": False},
    },
)

# The real C1 numbers: Madar 0.536 eV vs Kavosh 0.559 eV, a0 5.470 vs 5.458.
AGREEING = {
    "madar": {"latticeConstant_A": 5.470, "indirectGap_eV": 0.536},
    "kavosh": {"latticeConstant_A": 5.458, "indirectGap_eV": 0.559},
}


def test_agreeing_methods_pass():
    r = run_agreement_checks(AGREEING, CARD)
    assert r.overall.severity == "NONE"
    assert r.overall.total == 2 and r.overall.passing == 2


def test_relative_tolerance_catches_a_lattice_constant_disagreement():
    out = {"a": {"latticeConstant_A": 5.40}, "b": {"latticeConstant_A": 5.65}}
    r = run_agreement_checks(out, CARD)
    assert r.overall.severity == "HIGH"
    assert [c.severity for c in r.checks] == ["fail"]


def test_absolute_tolerance_catches_a_gap_disagreement():
    out = {"a": {"indirectGap_eV": 0.30}, "b": {"indirectGap_eV": 0.56}}
    assert run_agreement_checks(out, CARD).overall.severity == "HIGH"


def test_non_gating_divergence_warns_without_failing():
    """The known B0 divergence must be surfaced, not suppressed, and not fatal."""
    out = {
        "madar": {"latticeConstant_A": 5.470, "bulkModulus_GPa": 133.0},
        "kavosh": {"latticeConstant_A": 5.458, "bulkModulus_GPa": 81.0},
    }
    r = run_agreement_checks(out, CARD)
    assert r.overall.severity == "LOW"          # visible, but the comparison stands
    b0 = next(c for c in r.checks if c.name.endswith("bulkModulus_GPa"))
    assert b0.severity == "warn"
    assert "not gating" in b0.detail


# --- the anti-silent-pass contract ------------------------------------------
# An envelope check returns NONE when nothing overlapped, which makes "checked
# everything and agreed" indistinguishable from "checked nothing". Agreement
# must not inherit that.


def test_nothing_comparable_is_a_failure_not_a_pass():
    out = {"a": {"somethingElse": 1.0}, "b": {"anotherThing": 2.0}}
    r = run_agreement_checks(out, CARD)
    assert r.overall.severity == "HIGH"
    assert r.overall.total == 0
    assert "absent comparison" in r.diagnosis


def test_observable_reported_by_only_one_method_is_not_silently_dropped():
    out = {"a": {"latticeConstant_A": 5.47, "indirectGap_eV": 0.54}, "b": {"latticeConstant_A": 5.46}}
    r = run_agreement_checks(out, CARD)
    assert r.overall.severity == "NONE"          # the comparable one agrees
    assert r.overall.total == 1
    assert "indirectGap_eV" in r.diagnosis        # the skipped one is named


def test_single_method_raises_rather_than_reporting_agreement():
    with pytest.raises(ValueError, match="cannot corroborate itself"):
        run_agreement_checks({"madar": {"latticeConstant_A": 5.47}}, CARD)


def test_card_without_tolerances_reports_absence_not_agreement():
    bare = CARD.model_copy(update={"crossMethodTolerances": None})
    r = run_agreement_checks(AGREEING, bare)
    assert r.overall.severity == "HIGH"


def test_three_methods_use_the_full_spread_not_pairwise():
    out = {
        "a": {"latticeConstant_A": 5.46},
        "b": {"latticeConstant_A": 5.47},
        "c": {"latticeConstant_A": 5.65},   # only a-c exceeds 1%
    }
    assert run_agreement_checks(out, CARD).overall.severity == "HIGH"


def test_detail_names_every_method_and_value():
    detail = run_agreement_checks(AGREEING, CARD).checks[0].detail
    assert "madar=" in detail and "kavosh=" in detail
