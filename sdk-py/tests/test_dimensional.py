"""Tests for the dimensional algebra primitives."""

from __future__ import annotations

from artano_lemma import DimVec, dims_equal, is_dimensionless, stringify_dims


# ---------------------------------------------------------------------------
# dims_equal
# ---------------------------------------------------------------------------


def test_empty_vectors_equal() -> None:
    assert dims_equal({}, {})
    assert dims_equal(DimVec(), DimVec())
    assert dims_equal({}, DimVec())


def test_explicit_zero_equals_omission() -> None:
    """Explicit ``{L: 0}`` and omitting ``L`` are the same canonical form."""
    assert dims_equal({"L": 0, "T": 1}, {"T": 1})
    assert dims_equal({"L": 0, "T": 1}, DimVec(T=1))


def test_axis_order_irrelevant() -> None:
    assert dims_equal({"L": 2, "T": -2}, {"T": -2, "L": 2})


def test_mismatched_vectors_unequal() -> None:
    assert not dims_equal({"L": 1}, {"L": 2})
    assert not dims_equal({"L": 1}, {"T": 1})


def test_mixed_dict_and_model() -> None:
    a = DimVec(L=2, T=-2)
    b = {"L": 2, "T": -2}
    assert dims_equal(a, b)
    assert dims_equal(b, a)


# ---------------------------------------------------------------------------
# stringify_dims
# ---------------------------------------------------------------------------


def test_stringify_empty_is_dimensionless() -> None:
    assert stringify_dims({}) == "dimensionless"
    assert stringify_dims(DimVec()) == "dimensionless"


def test_stringify_single_unit_axis() -> None:
    assert stringify_dims({"L": 1}) == "L"


def test_stringify_axis_with_exponent() -> None:
    assert stringify_dims({"L": 2}) == "L^2"
    assert stringify_dims({"L": -3}) == "L^-3"


def test_stringify_canonical_axis_order() -> None:
    """Axes render in the canonical order L, T, M, E, Q, Theta, N — regardless
    of insertion order in the input."""
    expr = stringify_dims({"T": -2, "L": 2})
    assert expr == "L^2·T^-2"


def test_stringify_uses_greek_theta() -> None:
    """Temperature renders as Greek capital theta to match the TS reference."""
    assert stringify_dims({"Theta": 1}) == "Θ"
    assert stringify_dims({"Theta": -1}) == "Θ^-1"


def test_stringify_combined_example() -> None:
    """Match the example in the docstring: ``L^-3·E^-1·N``."""
    assert stringify_dims({"L": -3, "E": -1, "N": 1}) == "L^-3·E^-1·N"


# ---------------------------------------------------------------------------
# is_dimensionless
# ---------------------------------------------------------------------------


def test_empty_is_dimensionless() -> None:
    assert is_dimensionless({})
    assert is_dimensionless(DimVec())


def test_all_zero_is_dimensionless() -> None:
    assert is_dimensionless({"L": 0, "T": 0})


def test_nonzero_is_not_dimensionless() -> None:
    assert not is_dimensionless({"L": 1})
    assert not is_dimensionless({"L": 2, "T": -2})
