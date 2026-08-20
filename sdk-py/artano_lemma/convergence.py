# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Verify a claimed convergence order against the refinement study behind it.

## Why this check and not the one that was planned

`40-usce-roadmap.md` scoped two v2 checks: an *asymptotic-decay fit over
time-series outputs* and a *causality scan* confirming nothing reacts before its
cause. Surveying what the corpus actually claims showed **neither matches it**:

* The corpus's "decay" statements are almost all **limits in a parameter**
  (``T -> 0: k -> 0``, ``r -> infinity: |F| -> 0``), already covered by the
  ``limits[]`` machinery. Very few are decay in *time*.
* Its single causality claim is ``Im chi_0(omega > 0) <= 0`` on
  ``lindhard-susceptibility`` — a **sign condition on a response function in
  frequency space**, not a temporal ordering.

What the corpus does claim, twice and with envelopes already declared, is a
**convergence order**: ``finite-difference-truncation-error`` bounds
``observedConvergenceOrder`` to ``[1.8, 2.2]`` and ``runge-kutta-4`` to
``[3.8, 4.2]``.

And that exposed the real gap. USCE range-checks the order **a user reports**.
Nothing checks that the number was measured correctly — so the most
safety-critical number on a numerical-methods card is self-reported. This
recomputes it from the refinement study itself.

## What the card had to declare, and what it did not

The roadmap assumed both v2 checks would need "new card fields declaring what to
check". For the **inputs**, no: the envelope already names the quantity and
bounds it, so the check shipped reading nothing new. That only became clear by
building the checker against real claims rather than designing fields for it
first — the same lesson the ``evolution`` spec taught when the planned "check
the derivative vanishes" turned out to fit neither card carrying a conservation
law.

One field *was* needed, for a different reason. The fit-quality threshold
decides whether a result is ``warn`` or ``fail``, and it began life as an engine
constant — a judgement made on the card's behalf, with no recorded reasoning,
in a system whose whole argument is that such numbers belong in the card with a
``basis``. Cards may now declare ``convergence.maxPerLevelSpread``. Where they
do not, the fallback is used **and named in the verdict**, so the provenance of
the number that decided the outcome is always legible.

## The distinction this check exists to preserve

A refinement sequence that includes round-off-limited points fits a shallower
slope — the fixture in the tests gives **1.70**, which falls outside
``[1.8, 2.2]``. Reporting that as ``fail`` would tell the user their scheme is
not second-order, when in fact their *sequence* is contaminated and the scheme
is fine. The card itself warns about exactly this: *"at very small h,
subtraction of nearly-equal values amplifies machine precision noise as 1/h"*.

So a sequence that is not a clean power law returns ``warn`` with the per-level
orders attached, never ``fail``. *Cannot check* and *checked, and it is wrong*
do not share a code path.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

from .types import Card, EvaluateOverall, EvaluateResult, UsceCheck

__all__ = ["ConvergencePoint", "estimate_order", "run_convergence_check"]

#: One level of a refinement study: the discretisation parameter and the error
#: observed at it.
ConvergencePoint = tuple[float, float]

#: Default key. Both corpus cards that declare an order use this name.
DEFAULT_KEY = "observedConvergenceOrder"

#: Fallback used only when the card declares no ``convergence.maxPerLevelSpread``.
#:
#: This number **decides verdicts** — it separates "not a clean power law"
#: (``warn``) from "wrong order" (``fail``) — so leaving it here unqualified put
#: a judgement in the engine that everywhere else in this system lives in the
#: card with a recorded ``basis``. Cards can now declare it. When they do not,
#: the fallback applies **and the verdict says so**, so the provenance of the
#: number that decided the outcome is never silent.
DEFAULT_SPREAD = 0.5


def _envelope_bounds(card: Card, key: str) -> tuple[float, float] | None:
    envelopes = getattr(card, "validationEnvelopes", None) or {}
    value = envelopes.get(key)
    if isinstance(value, (list, tuple)) and len(value) == 2:
        return float(value[0]), float(value[1])
    if isinstance(value, dict) and "min" in value and "max" in value:
        return float(value["min"]), float(value["max"])
    return None


def estimate_order(points: Sequence[ConvergencePoint]) -> tuple[float, list[float]]:
    """Least-squares slope of log(error) against log(h), plus per-level orders.

    The per-level orders are what make a bad fit diagnosable: a clean power law
    gives roughly the same order between every consecutive pair, so a single
    divergent entry points at the refinement level that broke rather than
    condemning the whole study.
    """
    xs = [math.log(h) for h, _ in points]
    ys = [math.log(e) for _, e in points]
    n = len(xs)
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = sxy / sxx

    pairwise = [
        (ys[i] - ys[i + 1]) / (xs[i] - xs[i + 1])
        for i in range(n - 1)
        if xs[i] != xs[i + 1]
    ]
    return slope, pairwise


def run_convergence_check(
    points: Iterable[ConvergencePoint],
    card: Card,
    *,
    key: str | None = None,
    spread: float | None = None,
) -> EvaluateResult:
    """Recompute a convergence order from its refinement study and check it.

    ``points`` are ``(h, error)`` pairs — the discretisation parameter and the
    error measured at it. The card supplies the expected order through its
    ``validationEnvelopes[key]``.
    """
    # Precedence: explicit argument > the card's own declaration > the fallback.
    # The card outranks the engine because a threshold that decides a verdict is
    # the card's judgement to make; the caller outranks both so a one-off study
    # can be re-examined without editing the corpus.
    declared = getattr(card, "convergence", None)
    key = key or (getattr(declared, "orderKey", None) if declared else None) or DEFAULT_KEY
    declared_spread = getattr(declared, "maxPerLevelSpread", None) if declared else None
    if spread is not None:
        spread, spread_source = spread, "supplied by the caller"
    elif declared_spread is not None:
        spread, spread_source = float(declared_spread), f"declared by {card.id}"
    else:
        spread, spread_source = DEFAULT_SPREAD, "the engine default, not declared by this card"

    name = f"USCE.convergence_{key}"
    checks: list[UsceCheck] = []

    def result(severity: str, diagnosis: str) -> EvaluateResult:
        passing = sum(1 for c in checks if c.severity == "pass")
        return EvaluateResult(
            checks=checks,
            diagnosis=diagnosis,
            overall=EvaluateOverall(passing=passing, total=len(checks), severity=severity),
        )

    data = [(float(h), float(e)) for h, e in points]
    bounds = _envelope_bounds(card, key)

    if bounds is None:
        checks.append(
            UsceCheck(
                name=name,
                severity="warn",
                detail=(
                    f"Card \"{card.id}\" declares no {key} envelope, so there is nothing to "
                    f"check the measured order against. Add one to make this claim verifiable."
                ),
            )
        )
        return result("NONE", f"No {key} envelope on this card — the order was not checked.")

    if len(data) < 2:
        checks.append(
            UsceCheck(
                name=name,
                severity="warn",
                detail=(
                    f"A convergence order needs at least two refinement levels; got "
                    f"{len(data)}. Neither confirmed nor refuted."
                ),
            )
        )
        return result("NONE", "Too few refinement levels to estimate an order.")

    bad = [(h, e) for h, e in data if h <= 0 or e <= 0]
    if bad:
        checks.append(
            UsceCheck(
                name=name,
                severity="warn",
                detail=(
                    # `%g`, not Python's float repr: repr renders 0.0 as "0.0" while
                    # the TypeScript port renders it "0", and the two engines are
                    # contracted to byte-identical prose.
                    f"Refinement levels must have positive h and positive error to fit a power "
                    f"law; got ({bad[0][0]:g}, {bad[0][1]:g}). An error of exactly zero usually means "
                    f"the exact solution was recovered at that level, which carries no order "
                    f"information."
                ),
            )
        )
        return result("NONE", "Refinement data is not fittable as a power law.")

    if len({h for h, _ in data}) != len(data):
        checks.append(
            UsceCheck(
                name=name,
                severity="warn",
                detail=(
                    "Two refinement levels share the same h, so the slope is undefined there. "
                    "Neither confirmed nor refuted."
                ),
            )
        )
        return result("NONE", "Duplicate refinement levels.")

    data.sort(key=lambda p: -p[0])  # coarsest first, so per-level orders read in refinement order
    order, pairwise = estimate_order(data)
    lo, hi = bounds
    rendered = ", ".join(f"{p:.3g}" for p in pairwise)

    # Quality first. A contaminated sequence can land outside the envelope while
    # the scheme is perfectly correct, so the fit must be judged before the
    # order is.
    if len(pairwise) >= 2 and (max(pairwise) - min(pairwise)) > spread:
        checks.append(
            UsceCheck(
                name=name,
                severity="warn",
                detail=(
                    f"The refinement sequence is not a clean power law: per-level orders are "
                    f"{rendered}, spanning {max(pairwise) - min(pairwise):.3g} (> {spread:g}, "
                    f"{spread_source}). "
                    f"The overall fit gives {order:.3g}, but that number does not describe "
                    f"this data. A tail that flattens usually means round-off-limited levels "
                    f"at small h; a leading level that is off usually means the asymptotic "
                    f"regime had not been reached yet. Drop the offending levels and re-run "
                    f"rather than reading this as a verdict on the method."
                ),
            )
        )
        return result(
            "NONE",
            "The refinement study does not support an order estimate — neither confirmed "
            "nor refuted. Inspect the per-level orders before drawing a conclusion.",
        )

    if lo <= order <= hi:
        checks.append(
            UsceCheck(
                name=name,
                severity="pass",
                detail=(
                    f"Observed convergence order {order:.4g} is within [{lo:g}, {hi:g}], "
                    f"measured over {len(data)} refinement levels (per-level: {rendered})."
                ),
            )
        )
        return result(
            "NONE",
            "The measured convergence order matches the order the card declares.",
        )

    checks.append(
        UsceCheck(
            name=name,
            severity="fail",
            detail=(
                f"Observed convergence order {order:.4g} is outside [{lo:g}, {hi:g}] "
                f"(per-level: {rendered}). The refinement study is a clean power law, so this "
                f"is a genuine order mismatch rather than a noisy measurement — the method is "
                f"not converging at the rate the card declares."
            ),
        )
    )
    return result(
        "HIGH",
        "The measured convergence order contradicts the card. A clean power law at the "
        "wrong slope points at the implementation, not at the measurement.",
    )
