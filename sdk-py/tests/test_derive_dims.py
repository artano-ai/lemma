"""Tests for formula-derived dimensional analysis."""

from __future__ import annotations

import pytest

from artano_lemma import (
    DerivationError,
    derive_dims,
    parse_card,
    run_hypothesis_checks,
)
from artano_lemma.dimensional import dims_equal


def test_propagator_kinetic_energy():
    d = derive_dims("(1/2)*m*v**2", {"m": {"M": 1}, "v": {"L": 1, "T": -1}})
    assert dims_equal(d, {"M": 1, "L": 2, "T": -2})


def test_propagator_product_division_power_unary():
    assert dims_equal(derive_dims("m*v", {"m": {"M": 1}, "v": {"L": 1, "T": -1}}), {"M": 1, "L": 1, "T": -1})
    assert dims_equal(derive_dims("a/b", {"a": {"L": 1}, "b": {"T": 1}}), {"L": 1, "T": -1})
    assert dims_equal(derive_dims("x**3", {"x": {"L": 1}}), {"L": 3})
    assert dims_equal(derive_dims("-x", {"x": {"M": 1}}), {"M": 1})
    assert dims_equal(derive_dims("2*x", {"x": {"M": 1}}), {"M": 1})  # numeric literal is dimensionless


def test_addition_requires_equal_dims():
    assert dims_equal(derive_dims("a+b", {"a": {"L": 1}, "b": {"L": 1}}), {"L": 1})
    with pytest.raises(DerivationError):
        derive_dims("a+b", {"a": {"L": 1}, "b": {"T": 1}})


def test_unsupported_raises_derivation_error():
    with pytest.raises(DerivationError):
        derive_dims("S**(1/4)", {"S": {"M": 1}})   # fractional power
    with pytest.raises(DerivationError):
        derive_dims("a*b", {"a": {"M": 1}})         # undeclared symbol
    with pytest.raises(DerivationError):
        derive_dims("sqrt(x)", {"x": {"L": 2}})     # function call


def _hyp(dimensional: dict) -> dict:
    return {
        "kind": "hypothesis", "id": "t", "version": "0.1.0", "name": "t",
        "proposal": "p", "proposedFormulaTeX": "f", "origin": "llm",
        "references": ["x"], "checks": {"dimensional": dimensional},
    }


def _dim_check(card_dict: dict):
    res = run_hypothesis_checks(parse_card(card_dict), corpus=[])
    return next(c for c in res.checks if c.name == "Hypothesis.dimensional_analysis")


def test_engine_derives_pass():
    c = _dim_check(_hyp({
        "lhsLabel": "E", "lhsDims": {"M": 1, "L": 2, "T": -2},
        "rhsLabel": "½mv²", "rhsDims": {"M": 1, "L": 2, "T": -2},
        "expr": "(1/2)*m*v**2", "symbols": {"m": {"M": 1}, "v": {"L": 1, "T": -1}},
    }))
    assert c.severity == "pass"
    assert "Derived from formula" in c.detail


def test_engine_catches_declared_but_wrong_formula():
    # Declares energy on BOTH sides, but the formula is m*v (M·L·T⁻¹).
    # The old declared-only check passed this; the derived check catches it.
    c = _dim_check(_hyp({
        "lhsLabel": "E", "lhsDims": {"M": 1, "L": 2, "T": -2},
        "rhsLabel": "m v", "rhsDims": {"M": 1, "L": 2, "T": -2},
        "expr": "m*v", "symbols": {"m": {"M": 1}, "v": {"L": 1, "T": -1}},
    }))
    assert c.severity == "fail"
    assert "derives to" in c.detail


def test_engine_falls_back_when_not_derivable():
    c = _dim_check(_hyp({
        "lhsLabel": "T", "lhsDims": {"Theta": 1},
        "rhsLabel": "(S)^¼", "rhsDims": {"Theta": 1},
        "expr": "S**(1/4)", "symbols": {"S": {"Theta": 4}},
    }))
    assert c.severity == "pass"
    assert "not derivable" in c.detail


def test_engine_without_expr_uses_declared():
    c = _dim_check(_hyp({
        "lhsLabel": "E", "lhsDims": {"M": 1}, "rhsLabel": "m", "rhsDims": {"M": 1},
    }))
    assert c.severity == "pass"
    assert "Derived" not in c.detail
