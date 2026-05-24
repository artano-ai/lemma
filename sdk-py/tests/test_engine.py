"""Tests for the hypothesis cross-check engine."""

from __future__ import annotations

from typing import Any

import pytest

from artano_lemma import (
    Card,
    HypothesisCard,
    HypothesisChecksSpec,
    PrincipleCard,
    parse_card,
    run_hypothesis_checks,
)


# ---------------------------------------------------------------------------
# Fixtures — a small corpus and a hypothesis-card builder
# ---------------------------------------------------------------------------


def _make_principle(card_id: str, name: str = "Test") -> PrincipleCard:
    """Build a minimal valid PrincipleCard for corpus fixtures."""
    payload = {
        "kind": "principle",
        "id": card_id,
        "version": "1.0.0",
        "name": name,
        "principles": [],
        "formulaTeX": "y = x",
        "conventions": [],
        "expectedLimits": [],
        "references": [],
    }
    card = parse_card(payload)
    assert isinstance(card, PrincipleCard)
    return card


@pytest.fixture
def small_corpus() -> list[Card]:
    return [
        _make_principle("free-fall-uniform-gravity"),
        _make_principle("classical-energy-conservation"),
        _make_principle("ideal-gas-law"),
    ]


def _hypothesis(**overrides: Any) -> HypothesisCard:
    base = {
        "kind": "hypothesis",
        "id": "test-hypothesis",
        "version": "0.1.0",
        "name": "Test hypothesis",
        "proposal": "A toy proposal for testing.",
        "proposedFormulaTeX": "y = x",
        "checks": {},
        "references": [],
        "origin": "human",
    }
    base.update(overrides)
    card = parse_card(base)
    assert isinstance(card, HypothesisCard)
    return card


# ---------------------------------------------------------------------------
# Dimensional check
# ---------------------------------------------------------------------------


def test_dimensional_match_passes(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "kinetic + potential",
                "rhsDims": {"M": 1, "L": 2, "T": -2},
            },
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert len(result.checks) == 1
    assert result.checks[0].name == "Hypothesis.dimensional_analysis"
    assert result.checks[0].severity == "pass"
    assert result.overall.severity == "NONE"
    assert result.overall.passing == 1
    assert result.overall.total == 1


def test_dimensional_mismatch_fails(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "force",
                "rhsDims": {"M": 1, "L": 1, "T": -2},
            },
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].severity == "fail"
    assert "mismatch" in result.checks[0].detail.lower()
    assert result.overall.severity == "HIGH"
    assert "fails one or more hard cross-checks" in result.diagnosis


# ---------------------------------------------------------------------------
# Reference-corpus check
# ---------------------------------------------------------------------------


def test_reference_corpus_all_resolve(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "referenceCorpus": {
                "mustAgreeWith": ["free-fall-uniform-gravity"],
                "mayContradict": ["ideal-gas-law"],
            },
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].severity == "pass"
    assert "All declared references resolve" in result.checks[0].detail


def test_reference_corpus_missing_id_fails(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "referenceCorpus": {
                "mustAgreeWith": ["definitely-not-a-real-card"],
            },
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].severity == "fail"
    assert "definitely-not-a-real-card" in result.checks[0].detail


# ---------------------------------------------------------------------------
# Limit and conservation checks (warn-only)
# ---------------------------------------------------------------------------


def test_limit_check_is_warn(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "limits": [
                {
                    "name": "weak-field",
                    "regime": "v << c",
                    "expectedReducesTo": "free-fall-uniform-gravity",
                },
            ],
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].name == "Hypothesis.limit_weak-field"
    assert result.checks[0].severity == "warn"
    assert "corpus card" in result.checks[0].detail
    assert result.overall.severity == "LOW"


def test_limit_check_unknown_target_still_warn(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "limits": [
                {
                    "name": "test",
                    "regime": "small x",
                    "expectedReducesTo": "x",
                },
            ],
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].severity == "warn"
    assert "corpus card" not in result.checks[0].detail


def test_conservation_law_is_warn(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "conservationLaws": [
                {"law": "energy", "statement": "total energy is conserved"},
            ],
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].name == "Hypothesis.conservation_energy"
    assert result.checks[0].severity == "warn"
    assert result.overall.severity == "LOW"


# ---------------------------------------------------------------------------
# derivedFrom check
# ---------------------------------------------------------------------------


def test_derived_from_resolves(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        derivedFrom={
            "cardId": "free-fall-uniform-gravity",
            "relationship": "extends",
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].name == "Hypothesis.derived_from"
    assert result.checks[0].severity == "pass"
    assert "free-fall-uniform-gravity" in result.checks[0].detail


def test_derived_from_missing_fails(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        derivedFrom={
            "cardId": "missing-card",
            "relationship": "replaces",
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks[0].severity == "fail"
    assert result.overall.severity == "HIGH"


# ---------------------------------------------------------------------------
# Combined rolls
# ---------------------------------------------------------------------------


def test_no_checks_declared_rolls_up_to_none(small_corpus: list[Card]) -> None:
    card = _hypothesis(checks={})
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.checks == []
    assert result.overall.severity == "NONE"
    assert "All declared cross-checks pass" in result.diagnosis


def test_pass_plus_warn_rolls_up_to_low(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "kinetic",
                "rhsDims": {"M": 1, "L": 2, "T": -2},
            },
            "limits": [
                {"name": "small", "regime": "x→0", "expectedReducesTo": "ideal-gas-law"},
            ],
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.overall.severity == "LOW"
    assert result.overall.passing == 1
    assert result.overall.total == 2
    assert "limit / conservation claims" in result.diagnosis


def test_fail_overrides_warn(small_corpus: list[Card]) -> None:
    card = _hypothesis(
        checks={
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1},
                "rhsLabel": "force",
                "rhsDims": {"L": 1},
            },
            "limits": [
                {"name": "x", "regime": "y", "expectedReducesTo": "ideal-gas-law"},
            ],
        },
    )
    result = run_hypothesis_checks(card, corpus=small_corpus)
    assert result.overall.severity == "HIGH"
    assert "fails one or more hard cross-checks" in result.diagnosis


# ---------------------------------------------------------------------------
# Empty checks spec
# ---------------------------------------------------------------------------


def test_empty_checks_spec() -> None:
    card = _hypothesis(checks={})
    assert isinstance(card.checks, HypothesisChecksSpec)
    assert card.checks.dimensional is None
    assert card.checks.limits is None
