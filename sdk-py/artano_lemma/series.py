# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Check a reported series against declared sign and bound conditions.

## Why this reaches cards nothing else could

`40-usce-roadmap.md` records five cards as **declared envelope refusals** —
their values have no system-independent range, so any numeric bound would encode
one calculation's setup rather than the physics. `density-of-states` says so
explicitly: *"it scales with the cell volume and the number of bands, and its
shape depends on the basis, the k-mesh and the smearing width"*.

But two of those five carry a condition that **is** universal:

* ``density-of-states`` — ``g(epsilon) >= 0``
* ``joint-dos`` — ``J(omega) >= 0``

A density of states cannot be negative in any material, at any k-mesh, under any
smearing. The magnitude is unboundable; the sign is not. So this check gives
verification coverage to cards the envelope check structurally cannot reach,
which is a larger gain than another check on already-covered cards would be.

The third real claim is ``lindhard-susceptibility``'s
``Im chi_0(omega > 0) <= 0`` — the passivity statement of causality. It needs
the same machinery plus a domain restriction, which is what ``where`` is for.

## Why the conditions are structured rather than expressions

An expression language would need a CAS to evaluate, making this Python-only
like the symbolic adapter. A structured comparison — quantity, operator, value,
optional domain restriction — is arithmetic both runtimes do identically, so
this stays parity-safe. The corpus's real claims all fit that shape; none of
them needs algebra.

## Conditions come from the card

Cards declare these in ``seriesConditions``; passing them explicitly is for
exploring a claim a card does not yet carry. The corpus is the normal source,
because a condition stated only in prose depends on every caller remembering it
— ``g(epsilon) >= 0`` sat in ``density-of-states``'s ``conventions`` for months
with nothing able to read it.

The field was added **after** the checker worked, not before. That ordering is
the lesson ``evolution``, ``fixedPoint`` and the convergence check each taught:
designing card fields ahead of a checker produces a format the checker cannot
use.
"""

from __future__ import annotations

import math
from typing import Iterable, Mapping, Sequence

from .types import Card, EvaluateOverall, EvaluateResult, UsceCheck

__all__ = ["SeriesCondition", "run_series_checks"]

_OPS = {
    ">": lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<": lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
}


class SeriesCondition:
    """One declared condition on a reported series.

    ``of`` names the quantity, ``op``/``value`` the comparison it must satisfy,
    and ``where`` optionally restricts which samples the claim covers — a claim
    about ``omega > 0`` says nothing about negative frequencies, and testing it
    there would manufacture a violation the card never asserted.
    """

    __slots__ = ("of", "op", "value", "where", "label")

    def __init__(
        self,
        of: str,
        op: str,
        value: float,
        *,
        where: "SeriesCondition | None" = None,
        label: str | None = None,
    ) -> None:
        if op not in _OPS:
            raise ValueError(f"Unknown operator {op!r}; expected one of {', '.join(sorted(_OPS))}.")
        self.of = of
        self.op = op
        self.value = float(value)
        self.where = where
        self.label = label or f"{of} {op} {value:g}"


def _card_conditions(card: Card) -> list[SeriesCondition]:
    """The conditions a card declares, as engine objects."""
    declared = getattr(card, "seriesConditions", None) or []
    out: list[SeriesCondition] = []
    for spec in declared:
        where = getattr(spec, "where", None)
        out.append(
            SeriesCondition(
                spec.of,
                spec.op,
                spec.value,
                where=SeriesCondition(where.of, where.op, where.value) if where else None,
            )
        )
    return out


def _describe(condition: SeriesCondition) -> str:
    text = f"{condition.of} {condition.op} {condition.value:g}"
    if condition.where is not None:
        text += f" where {condition.where.of} {condition.where.op} {condition.where.value:g}"
    return text


def run_series_checks(
    series: Mapping[str, Sequence[float]],
    card: Card,
    conditions: Iterable[SeriesCondition] | None = None,
) -> EvaluateResult:
    """Test each declared condition against the reported series.

    ``series`` maps a quantity name to its samples — the columns of one table,
    so every column must be the same length.

    ``conditions`` defaults to whatever the **card** declares in
    ``seriesConditions``. Passing them explicitly is for exploring a claim a
    card does not yet carry; the corpus is the normal source, so that a
    condition stated in a card is actually enforced rather than depending on
    every caller to remember it.
    """
    checks: list[UsceCheck] = []
    columns = {k: [float(x) for x in v] for k, v in series.items()}
    conditions = list(conditions) if conditions is not None else _card_conditions(card)

    def finish() -> EvaluateResult:
        passing = sum(1 for c in checks if c.severity == "pass")
        any_fail = any(c.severity == "fail" for c in checks)
        severity = "HIGH" if any_fail else "NONE"
        if any_fail:
            diagnosis = (
                "A reported series violates a condition the card declares. Unlike a value "
                "outside an envelope, a sign violation is not a matter of tolerance — the "
                "quantity is outside its own definition."
            )
        elif not checks:
            diagnosis = (
                "This card declares no seriesConditions and none were supplied, so "
                "nothing was checked."
            )
        elif passing == len(checks):
            diagnosis = "Every declared condition holds across the reported series."
        else:
            diagnosis = (
                "Some conditions could not be evaluated against the series provided — "
                "recorded, neither confirmed nor refuted."
            )
        return EvaluateResult(
            checks=checks,
            diagnosis=diagnosis,
            overall=EvaluateOverall(passing=passing, total=len(checks), severity=severity),
        )

    lengths = {len(v) for v in columns.values()}
    if len(lengths) > 1:
        for condition in conditions:
            checks.append(
                UsceCheck(
                    name=f"USCE.series_{condition.of}",
                    severity="warn",
                    detail=(
                        f"The reported columns have different lengths ({', '.join(str(n) for n in sorted(lengths))}), "
                        f"so they are not samples of one series and cannot be compared point by point."
                    ),
                )
            )
        return finish()

    for condition in conditions:
        name = f"USCE.series_{condition.of}"
        described = _describe(condition)

        if condition.of not in columns:
            checks.append(
                UsceCheck(
                    name=name,
                    severity="warn",
                    detail=(
                        f"Condition \"{described}\" was declared, but the run reports no "
                        f"\"{condition.of}\" series. Reported: "
                        f"{', '.join(sorted(columns)) or 'nothing'}. Neither confirmed nor refuted."
                    ),
                )
            )
            continue

        values = columns[condition.of]
        indices = range(len(values))

        if condition.where is not None:
            if condition.where.of not in columns:
                checks.append(
                    UsceCheck(
                        name=name,
                        severity="warn",
                        detail=(
                            f"Condition \"{described}\" restricts to \"{condition.where.of}\", "
                            f"which the run does not report, so the samples it covers cannot be "
                            f"identified. Neither confirmed nor refuted."
                        ),
                    )
                )
                continue
            gate = columns[condition.where.of]
            predicate = _OPS[condition.where.op]
            indices = [i for i in indices if predicate(gate[i], condition.where.value)]

        selected = [(i, values[i]) for i in indices]
        if not selected:
            checks.append(
                UsceCheck(
                    name=name,
                    severity="warn",
                    detail=(
                        f"Condition \"{described}\" covers no reported sample, so it is "
                        f"vacuous here — neither confirmed nor refuted. Report samples inside "
                        f"the declared domain to test it."
                    ),
                )
            )
            continue

        nans = [i for i, v in selected if math.isnan(v)]
        if nans:
            checks.append(
                UsceCheck(
                    name=name,
                    severity="warn",
                    detail=(
                        f"Condition \"{described}\" cannot be evaluated: {len(nans)} of "
                        f"{len(selected)} covered samples are NaN. A comparison against NaN is "
                        f"false for every operator, so treating this as a violation would "
                        f"manufacture a verdict out of missing data."
                    ),
                )
            )
            continue

        predicate = _OPS[condition.op]
        violations = [(i, v) for i, v in selected if not predicate(v, condition.value)]

        if not violations:
            checks.append(
                UsceCheck(
                    name=name,
                    severity="pass",
                    detail=(
                        f"{described} holds across all {len(selected)} covered samples."
                    ),
                )
            )
            continue

        # Report the worst offender, not merely the first: it is the one that
        # tells you how badly the run is broken.
        worst = max(violations, key=lambda iv: abs(iv[1] - condition.value))
        checks.append(
            UsceCheck(
                name=name,
                severity="fail",
                detail=(
                    f"{described} is violated by {len(violations)} of {len(selected)} covered "
                    f"samples; the worst is {worst[1]:g} at index {worst[0]}. This is not a "
                    f"tolerance question — the quantity is outside its own definition."
                ),
            )
        )

    return finish()
