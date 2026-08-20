# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Sign and bound conditions over a reported series.

The point of this check is *which cards it reaches*. `40-usce-roadmap.md`
records five cards as declared envelope refusals — their values have no
system-independent range, so any numeric bound would encode one calculation's
setup. Two of them nevertheless carry a universal condition:
``density-of-states`` states ``g(epsilon) >= 0`` and ``joint-dos`` states
``J(omega) >= 0``. A density of states cannot be negative in any material, at
any k-mesh, under any smearing.

So this gives verification coverage to cards the envelope check structurally
cannot cover — which is why it was worth building over another check on cards
that already have envelopes.
"""

from __future__ import annotations

import math

import pytest

from artano_lemma import SeriesCondition, find_card, load_cards, run_series_checks

CARDS = load_cards()
DOS = find_card("density-of-states", CARDS)
JDOS = find_card("joint-dos", CARDS)
LINDHARD = find_card("lindhard-susceptibility", CARDS)

NON_NEGATIVE_G = SeriesCondition("g", ">=", 0)
PASSIVE = SeriesCondition("imChi", "<=", 0, where=SeriesCondition("omega", ">", 0))


# --- the cards this exists for ----------------------------------------------


def test_the_envelope_refusing_cards_are_the_ones_this_reaches():
    """Guard the premise, not just the code: if either card ever gains an
    envelope, the argument for this check weakens and someone should notice."""
    assert not DOS.validationEnvelopes, "density-of-states is a declared envelope refusal"
    assert not JDOS.validationEnvelopes, "joint-dos is a declared envelope refusal"
    assert any("g(epsilon) >= 0" in c for c in DOS.conventions)
    assert any("J(omega) >= 0" in c for c in JDOS.conventions)


def test_a_valid_density_of_states_passes():
    series = {"epsilon": [-2, -1, 0, 1, 2], "g": [0.0, 0.3, 1.2, 0.8, 0.0]}
    result = run_series_checks(series, DOS, [NON_NEGATIVE_G])
    assert result.overall.severity == "NONE"
    assert result.checks[0].severity == "pass"


def test_a_negative_density_of_states_is_refuted():
    """Not a tolerance question — a negative DOS is outside the definition of the
    quantity, whatever the system."""
    series = {"epsilon": [-2, -1, 0, 1, 2], "g": [0.0, -0.4, 1.2, 0.8, 0.0]}
    result = run_series_checks(series, DOS, [NON_NEGATIVE_G])
    assert result.overall.severity == "HIGH"
    assert result.checks[0].severity == "fail"
    assert "outside its own definition" in result.checks[0].detail


def test_the_failure_names_the_worst_offender_and_where_it_is():
    series = {"epsilon": [0, 1, 2, 3], "g": [-0.1, 1.0, -5.0, 1.0]}
    detail = run_series_checks(series, DOS, [NON_NEGATIVE_G]).checks[0].detail
    assert "violated by 2 of 4" in detail
    assert "the worst is -5 at index 2" in detail


# --- the domain restriction is load-bearing ---------------------------------


def test_a_claim_is_not_tested_outside_the_domain_it_covers():
    """`Im chi_0(omega > 0) <= 0` says nothing about negative frequencies.
    Im chi is positive at omega = -1 here and that is *correct* physics —
    testing the claim there would manufacture a violation the card never made."""
    series = {"omega": [-1, 0, 1, 2, 3], "imChi": [0.5, 0.0, -0.2, -0.4, -0.1]}
    result = run_series_checks(series, LINDHARD, [PASSIVE])
    assert result.checks[0].severity == "pass"
    assert "holds across all 3 covered samples" in result.checks[0].detail


def test_a_violation_inside_the_domain_is_caught():
    series = {"omega": [-1, 0, 1, 2, 3], "imChi": [0.5, 0.0, -0.2, 0.9, -0.1]}
    result = run_series_checks(series, LINDHARD, [PASSIVE])
    assert result.overall.severity == "HIGH"


def test_a_condition_covering_no_sample_is_vacuous_not_passing():
    """Reporting only omega < 0 does not verify a claim about omega > 0. Calling
    that `pass` would be the silent-success failure `require_checks` exists to
    prevent, one level down."""
    series = {"omega": [-3, -2, -1], "imChi": [0.5, 0.4, 0.3]}
    result = run_series_checks(series, LINDHARD, [PASSIVE])
    assert result.checks[0].severity == "warn"
    assert "vacuous here" in result.checks[0].detail


# --- conditions come from the corpus, not from every caller's memory --------


def test_conditions_are_read_from_the_card_by_default():
    """`g(epsilon) >= 0` sat in this card's `conventions` as prose with nothing
    able to read it. Declaring it machine-readably is what makes the claim
    enforced rather than dependent on every caller remembering it."""
    assert DOS.seriesConditions, "density-of-states should declare its own condition"
    assert DOS.seriesConditions[0].basis, "a declared condition must record why it holds"

    # No conditions passed — the card supplies them.
    good = run_series_checks({"epsilon": [-1, 0, 1], "g": [0.0, 1.2, 0.4]}, DOS)
    assert good.checks[0].severity == "pass"

    bad = run_series_checks({"epsilon": [-1, 0, 1], "g": [0.0, -1.2, 0.4]}, DOS)
    assert bad.overall.severity == "HIGH"


def test_the_domain_restricted_claim_survives_the_round_trip_through_the_card():
    """The `where` clause is the part most likely to be lost in translation, and
    losing it would turn correct physics at negative frequency into a failure."""
    assert LINDHARD.seriesConditions[0].where is not None
    series = {"omega": [-1, 0, 1, 2], "imChi0": [0.5, 0.0, -0.2, -0.4]}
    assert run_series_checks(series, LINDHARD).checks[0].severity == "pass"


def test_explicit_conditions_still_override_the_card():
    """Passing conditions is for exploring a claim a card does not yet carry."""
    result = run_series_checks(
        {"g": [1.0, 2.0]}, DOS, [SeriesCondition("g", ">", 5)]
    )
    assert result.overall.severity == "HIGH", "the supplied condition should win"


# --- everything unevaluable warns, never fails ------------------------------


def test_a_missing_quantity_warns_and_says_what_was_reported():
    result = run_series_checks({"omega": [1, 2]}, LINDHARD, [PASSIVE])
    assert result.checks[0].severity == "warn"
    assert "reports no \"imChi\" series" in result.checks[0].detail
    assert "Reported: omega" in result.checks[0].detail


def test_nan_is_not_treated_as_a_violation():
    """A comparison against NaN is false for *every* operator, so a naive check
    reports NaN as violating any condition. That would turn missing data into a
    verdict about the science."""
    series = {"omega": [1, 2], "imChi": [math.nan, -0.1]}
    result = run_series_checks(series, LINDHARD, [PASSIVE])
    assert result.checks[0].severity == "warn"
    assert result.overall.severity == "NONE"
    assert "manufacture a verdict out of missing data" in result.checks[0].detail


def test_ragged_columns_are_not_samples_of_one_series():
    series = {"omega": [1, 2, 3], "imChi": [-0.1]}
    result = run_series_checks(series, LINDHARD, [SeriesCondition("imChi", "<=", 0)])
    assert result.checks[0].severity == "warn"
    assert "different lengths" in result.checks[0].detail


def test_a_missing_domain_variable_warns():
    series = {"imChi": [-0.1, -0.2]}
    result = run_series_checks(series, LINDHARD, [PASSIVE])
    assert result.checks[0].severity == "warn"
    assert "does not report" in result.checks[0].detail


def test_no_conditions_checks_nothing_and_says_so():
    result = run_series_checks({"g": [1.0]}, DOS, [])
    assert result.overall.total == 0
    assert "nothing was checked" in result.diagnosis


# --- operators ---------------------------------------------------------------


@pytest.mark.parametrize(
    "op,value,samples,expected",
    [
        (">=", 0, [0.0, 1.0], "pass"),
        (">", 0, [0.0, 1.0], "fail"),
        ("<=", 0, [0.0, -1.0], "pass"),
        ("<", 0, [0.0, -1.0], "fail"),
    ],
)
def test_strict_and_non_strict_operators_differ_at_the_boundary(op, value, samples, expected):
    """A sample exactly at the bound distinguishes `>=` from `>`, and the corpus
    uses both — `g(epsilon) >= 0` admits zero, `g(epsilon_F) > 0` does not."""
    result = run_series_checks({"q": samples}, DOS, [SeriesCondition("q", op, value)])
    assert result.checks[0].severity == expected


def test_an_unknown_operator_is_rejected_at_construction():
    with pytest.raises(ValueError, match="Unknown operator"):
        SeriesCondition("q", "!=", 0)
