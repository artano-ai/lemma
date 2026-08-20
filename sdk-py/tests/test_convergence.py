# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Recomputing a convergence order from the refinement study behind it.

USCE range-checks the order a **user reports**. Nothing checked that the number
was measured correctly, so the most safety-critical value on a numerical-methods
card was self-reported. These tests pin the check that recomputes it.

The verdict boundary is the whole point, and it is subtler here than elsewhere:
a refinement sequence contaminated by round-off-limited levels fits a *shallower
slope* and lands outside the envelope. Reporting that as ``fail`` would tell the
user their scheme is not second-order, when the scheme is fine and the sequence
is contaminated. So fit quality is judged **before** the order, and a sequence
that is not a clean power law can only ever ``warn``.
"""

from __future__ import annotations

import pytest

from artano_lemma import find_card, load_cards, run_convergence_check
from artano_lemma.convergence import estimate_order

CARDS = load_cards()
FD = find_card("finite-difference-truncation-error", CARDS)  # envelope [1.8, 2.2]
RK4 = find_card("runge-kutta-4", CARDS)  # envelope [3.8, 4.2]

HS = [0.1, 0.05, 0.025, 0.0125]


def power_law(order: float, coefficient: float = 1e-3, hs=None):
    return [(h, coefficient * h**order) for h in (hs or HS)]


# --- the corpus claims this check was built for ------------------------------


def test_a_clean_second_order_study_matches_the_finite_difference_card():
    result = run_convergence_check(power_law(2), FD)
    assert result.overall.severity == "NONE"
    assert result.checks[0].severity == "pass"
    assert "within [1.8, 2.2]" in result.checks[0].detail


def test_a_clean_fourth_order_study_matches_the_runge_kutta_card():
    result = run_convergence_check(power_law(4), RK4)
    assert result.checks[0].severity == "pass"
    assert "within [3.8, 4.2]" in result.checks[0].detail


def test_a_scheme_converging_at_the_wrong_rate_is_refuted():
    """The defect this exists to catch: a first-order implementation of a method
    the card declares second-order. A clean power law at the wrong slope is a
    statement about the implementation, not about the measurement."""
    result = run_convergence_check(power_law(1), FD)
    assert result.overall.severity == "HIGH"
    assert result.checks[0].severity == "fail"
    assert "genuine order mismatch" in result.checks[0].detail


# --- the distinction that makes this usable ----------------------------------


def test_a_round_off_contaminated_sequence_warns_and_does_not_fail():
    """`finite-difference-truncation-error` warns that "at very small h,
    subtraction of nearly-equal values amplifies machine precision noise as
    1/h". Such a sequence fits order ~1.7 — outside [1.8, 2.2] — but the scheme
    is correct and the data is not. This must never read as a failed method."""
    contaminated = power_law(2) + [(0.00625, 3.9e-8), (0.003125, 4.2e-8)]
    result = run_convergence_check(contaminated, FD)

    assert result.overall.severity == "NONE", "a bad sequence is not a bad method"
    assert result.checks[0].severity == "warn"
    assert "not a clean power law" in result.checks[0].detail


def test_the_warning_names_the_level_that_broke():
    """Per-level orders are what make a bad fit actionable — a single divergent
    entry points at the refinement level to drop, instead of condemning the
    whole study."""
    contaminated = power_law(2) + [(0.00625, 3.9e-8), (0.003125, 4.2e-8)]
    detail = run_convergence_check(contaminated, FD).checks[0].detail
    assert "per-level orders are 2, 2, 2, 2, -0.107" in detail


def test_dropping_the_contaminated_tail_recovers_the_verdict():
    """The corrective action the warning recommends actually works."""
    assert run_convergence_check(power_law(2), FD).checks[0].severity == "pass"


# --- everything unfittable warns, never fails --------------------------------


@pytest.mark.parametrize(
    "points,expected_phrase",
    [
        ([(0.1, 1e-5)], "at least two refinement levels"),
        ([], "at least two refinement levels"),
        ([(0.1, 0.0), (0.05, 1e-6)], "positive h and positive error"),
        ([(0.1, 1e-5), (-0.05, 1e-6)], "positive h and positive error"),
        ([(0.1, 1e-5), (0.1, 2e-5)], "share the same h"),
    ],
)
def test_unfittable_input_warns(points, expected_phrase):
    result = run_convergence_check(points, FD)
    assert result.overall.severity == "NONE"
    assert result.checks[0].severity == "warn"
    assert expected_phrase in result.checks[0].detail


def test_a_card_without_an_envelope_says_so_rather_than_inventing_one():
    result = run_convergence_check(power_law(2), find_card("ideal-gas-law", CARDS))
    assert result.checks[0].severity == "warn"
    assert "declares no observedConvergenceOrder envelope" in result.checks[0].detail


# --- the number that decides the verdict must not be the engine's secret -----
# The fit-quality threshold separates `warn` from `fail`. It began as an engine
# constant, which put a judgement in the engine that everywhere else in this
# system lives in the card with a recorded `basis`. Cards may now declare it,
# and wherever the number comes from, the verdict names its source.


def test_the_threshold_is_read_from_the_card():
    assert FD.convergence is not None
    assert FD.convergence.maxPerLevelSpread == 0.4
    assert FD.convergence.basis, "a threshold that decides verdicts must record why"

    contaminated = power_law(2) + [(0.00625, 3.9e-8), (0.003125, 4.2e-8)]
    detail = run_convergence_check(contaminated, FD).checks[0].detail
    assert "declared by finite-difference-truncation-error" in detail


def test_a_card_without_a_declaration_says_the_default_was_used():
    """The fallback is fine; a *silent* fallback is not. A reader must be able to
    tell whether the number that decided the outcome came from the card or from
    the engine."""
    gas = find_card("ideal-gas-law", CARDS)
    assert gas.convergence is None
    # ideal-gas-law has no order envelope either, so use a card-shaped stand-in.
    from artano_lemma.types import PrincipleCard

    bare = PrincipleCard(
        kind="principle", id="bare", version="1.0.0", name="bare",
        principles=["p"], formulaTeX="x", conventions=["c"], expectedLimits=["l"],
        references=["r"], validationEnvelopes={"observedConvergenceOrder": [1.8, 2.2]},
    )
    contaminated = power_law(2) + [(0.00625, 3.9e-8), (0.003125, 4.2e-8)]
    detail = run_convergence_check(contaminated, bare).checks[0].detail
    assert "the engine default, not declared by this card" in detail


def test_the_caller_outranks_the_card():
    """A one-off study can be re-examined without editing the corpus — and the
    verdict says the number came from the caller."""
    contaminated = power_law(2) + [(0.00625, 3.9e-8), (0.003125, 4.2e-8)]
    result = run_convergence_check(contaminated, FD, spread=3.0)
    assert result.checks[0].severity == "fail", "a wider threshold judges the order instead"

    # The provenance clause appears where the threshold actually *decided* the
    # outcome. On a clean power law it decides nothing, so it is correctly
    # absent — reporting it there would be noise.
    narrow = run_convergence_check(contaminated, FD, spread=0.1)
    assert narrow.checks[0].severity == "warn"
    assert "supplied by the caller" in narrow.checks[0].detail
    assert "supplied by the caller" not in run_convergence_check(power_law(2), FD).checks[0].detail


def test_the_declared_threshold_actually_changes_the_verdict():
    """Guard that this is a real knob and not decoration."""
    borderline = [(0.1, 1e-3), (0.05, 2.6e-4), (0.025, 6.2e-5), (0.0125, 1.4e-5)]
    tight = run_convergence_check(borderline, FD, spread=0.01)
    loose = run_convergence_check(borderline, FD, spread=10.0)
    assert tight.checks[0].severity != loose.checks[0].severity


# --- the estimator itself ----------------------------------------------------


def test_order_is_recovered_exactly_for_a_pure_power_law():
    for p in (1, 2, 3, 4):
        order, pairwise = estimate_order(power_law(p))
        assert order == pytest.approx(p, abs=1e-9)
        assert all(x == pytest.approx(p, abs=1e-9) for x in pairwise)


def test_point_order_does_not_change_the_answer():
    """Refinement levels may arrive coarsest-first or finest-first; the fitted
    order is a property of the set, not of the listing order."""
    forward = run_convergence_check(power_law(2), FD).checks[0].detail
    reversed_ = run_convergence_check(list(reversed(power_law(2))), FD).checks[0].detail
    assert forward == reversed_


def test_the_estimate_is_scale_invariant_in_the_error_prefactor():
    """Doubling every error changes the constant, not the slope — so a study
    reported in different units still yields the same order."""
    a = run_convergence_check(power_law(2, coefficient=1e-3), FD).checks[0].detail
    b = run_convergence_check(power_law(2, coefficient=7.5), FD).checks[0].detail
    assert a == b
