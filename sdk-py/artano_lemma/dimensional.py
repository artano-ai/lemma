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


__all__ = [
    "AXES",
    "DimVecLike",
    "dims_equal",
    "stringify_dims",
    "is_dimensionless",
]
