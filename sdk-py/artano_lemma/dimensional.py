# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Tiny dimensional algebra.

Port of ``../mcp-server/src/cards/dimensional.ts`` to Python. Cards
declare both sides of a proposed equation as
:class:`~artano_lemma.types.DimVec` (integer exponents on the seven
primitive axes), and the engine compares canonical forms — no
unit-string parser, no LaTeX traversal. Cards are expected to
declare in canonical form directly.

The seven primitive axes are:

* ``L``     — length
* ``T``     — time
* ``M``     — mass
* ``E``     — energy
* ``Q``     — charge
* ``Theta`` — temperature
* ``N``     — count / particle number

Omitted axes default to zero. A vector with every axis zero renders
as ``"dimensionless"``.
"""

from __future__ import annotations

from typing import Mapping, Union

from .types import DimVec


AXES: tuple[str, ...] = ("L", "T", "M", "E", "Q", "Theta", "N")

_AXIS_LABEL: dict[str, str] = {
    "L": "L",
    "T": "T",
    "M": "M",
    "E": "E",
    "Q": "Q",
    "Theta": "Θ",  # Greek capital theta — matches the TS rendering
    "N": "N",
}


DimVecLike = Union[DimVec, Mapping[str, int]]
"""Anything that quacks like a DimVec: the Pydantic model itself, or
a plain ``dict``-style mapping from axis names to integer exponents."""


def _get(v: DimVecLike, axis: str) -> int:
    """Read one axis exponent, defaulting to zero when omitted."""
    if isinstance(v, DimVec):
        return getattr(v, axis, 0) or 0
    value = v.get(axis, 0)
    return int(value or 0)


def dims_equal(a: DimVecLike, b: DimVecLike) -> bool:
    """Return ``True`` iff every axis exponent matches.

    Two vectors are equal when their canonical forms agree — e.g.
    ``{L: 2, T: -2}`` equals ``{T: -2, L: 2}`` (axis order irrelevant)
    and equals ``{L: 2, T: -2, M: 0}`` (explicit zeros equivalent to
    omission).
    """
    for axis in AXES:
        if _get(a, axis) != _get(b, axis):
            return False
    return True


def stringify_dims(v: DimVecLike) -> str:
    """Render a DimVec in canonical human-readable form.

    Examples:

    >>> stringify_dims({})
    'dimensionless'
    >>> stringify_dims({'L': 1})
    'L'
    >>> stringify_dims({'L': -3, 'E': -1, 'N': 1})
    'L^-3·E^-1·N'
    """
    parts: list[str] = []
    for axis in AXES:
        exp = _get(v, axis)
        if exp == 0:
            continue
        label = _AXIS_LABEL[axis]
        parts.append(label if exp == 1 else f"{label}^{exp}")
    return "·".join(parts) if parts else "dimensionless"


def is_dimensionless(v: DimVecLike) -> bool:
    """``True`` iff every axis exponent is zero."""
    return all(_get(v, axis) == 0 for axis in AXES)


class DerivationError(ValueError):
    """Raised when an expression cannot be reduced to dimensions
    deterministically. The caller falls back to the declared vectors
    rather than guess."""


def _zero() -> dict[str, int]:
    return {axis: 0 for axis in AXES}


def _canon(v: DimVecLike) -> dict[str, int]:
    return {axis: _get(v, axis) for axis in AXES}


def _combine(a: dict[str, int], b: dict[str, int], sign: int) -> dict[str, int]:
    return {axis: a[axis] + sign * b[axis] for axis in AXES}


def _scale(a: dict[str, int], n: int) -> dict[str, int]:
    return {axis: a[axis] * n for axis in AXES}


def derive_dims(expr: str, symbols: Mapping[str, DimVecLike]) -> dict[str, int]:
    """Derive the dimensions of an ASCII expression from per-symbol dims.

    Supports ``+ - * /``, integer ``**``, parentheses, unary signs, and
    numeric literals (dimensionless). Raises :class:`DerivationError` on
    anything that cannot be resolved deterministically — a function call, a
    fractional or symbolic power, an undeclared symbol — so the caller can
    fall back to the declared vectors rather than emit a guess.
    """
    import ast

    table = {name: _canon(dims) for name, dims in symbols.items()}

    def exponent(node: ast.AST) -> int:
        if isinstance(node, ast.Constant) and isinstance(node.value, int) and not isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -exponent(node.operand)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
            return exponent(node.operand)
        raise DerivationError("exponent is not an integer literal")

    def walk(node: ast.AST) -> dict[str, int]:
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)):
                raise DerivationError(f"non-numeric constant {node.value!r}")
            return _zero()
        if isinstance(node, ast.Name):
            if node.id not in table:
                raise DerivationError(f"undeclared symbol {node.id!r}")
            return dict(table[node.id])
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return walk(node.operand)
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Mult):
                return _combine(walk(node.left), walk(node.right), 1)
            if isinstance(node.op, ast.Div):
                return _combine(walk(node.left), walk(node.right), -1)
            if isinstance(node.op, ast.Pow):
                return _scale(walk(node.left), exponent(node.right))
            if isinstance(node.op, (ast.Add, ast.Sub)):
                left, right = walk(node.left), walk(node.right)
                if left != right:
                    raise DerivationError(
                        "added terms differ dimensionally: "
                        f"{stringify_dims(left)} vs {stringify_dims(right)}"
                    )
                return left
        raise DerivationError(f"unsupported expression: {type(node).__name__}")

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise DerivationError(f"could not parse {expr!r}: {exc}") from exc
    return walk(tree.body)


__all__ = [
    "AXES",
    "DimVecLike",
    "DerivationError",
    "derive_dims",
    "dims_equal",
    "stringify_dims",
    "is_dimensionless",
]
