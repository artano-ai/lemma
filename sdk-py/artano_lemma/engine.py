"""Hypothesis cross-check engine.

Port of ``../mcp-server/src/cards/checks.ts`` to Python. Consumes a
:class:`~artano_lemma.types.HypothesisCard` and a corpus of cards,
runs the four declared check classes plus the ``derivedFrom`` link
resolution, and returns a deterministic
:class:`~artano_lemma.types.EvaluateResult` (per-check severity
verdicts + a roll-up).

v0 behaviour matches the Node reference:

* **Dimensional analysis** — real comparison of canonical
  :class:`~artano_lemma.types.DimVec` on both sides of the proposed
  equation. ``pass`` on match, ``fail`` on mismatch.
* **Reference-corpus check** — resolves declared
  ``mustAgreeWith`` / ``mayContradict`` ids against the live
  corpus. ``pass`` if every reference resolves, ``fail`` if any are
  missing.
* **Limit checks** — declarative. Recorded as ``warn`` pending
  symbolic verification (the hookup to SymPy / PySR is the planned
  v1 escalation).
* **Conservation laws** — same pattern as limits: ``warn`` pending
  symbolic / numerical verification.
* **derived-from** — real link resolution against the corpus.
  ``pass`` if the cited card id exists, ``fail`` otherwise.

The diagnosis strings are byte-identical to the Node reference so a
downstream consumer that diffs verdicts across language
implementations gets zero noise.
"""

from __future__ import annotations

from typing import Iterable, Sequence

from .dimensional import DerivationError, derive_dims, dims_equal, stringify_dims
from .types import (
    Card,
    ConservationLawSpec,
    DerivedFrom,
    DimensionalCheckSpec,
    EvaluateOverall,
    EvaluateResult,
    HypothesisCard,
    LimitCheckSpec,
    OverallSeverity,
    ReferenceCorpusCheckSpec,
    UsceCheck,
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def run_hypothesis_checks(
    card: HypothesisCard,
    *,
    corpus: Iterable[Card],
) -> EvaluateResult:
    """Run every declared check on ``card`` against ``corpus``.

    :param card: the :class:`HypothesisCard` to evaluate.
    :param corpus: the cards the hypothesis is being cross-checked
        against. Only ``.id`` is consulted, so any iterable of card
        objects (or anything with an ``id`` attribute) works.
    :returns: an :class:`EvaluateResult` aggregating one
        :class:`UsceCheck` per declared check, plus the overall
        roll-up and a diagnosis string.
    """
    corpus_list: Sequence[Card] = list(corpus)
    checks: list[UsceCheck] = []

    spec = card.checks
    if spec.dimensional is not None:
        checks.append(_check_dimensional(spec.dimensional))
    if spec.referenceCorpus is not None:
        checks.append(_check_reference_corpus(spec.referenceCorpus, corpus_list))
    if spec.limits is not None:
        for lim in spec.limits:
            checks.append(_check_limit(lim, corpus_list))
    if spec.conservationLaws is not None:
        for cons in spec.conservationLaws:
            checks.append(_check_conservation_law(cons))
    if card.derivedFrom is not None:
        checks.append(_check_derived_from(card.derivedFrom, corpus_list))

    passing = sum(1 for c in checks if c.severity == "pass")
    total = len(checks)
    any_fail = any(c.severity == "fail" for c in checks)
    any_warn = any(c.severity == "warn" for c in checks)

    severity: OverallSeverity = "NONE"
    if any_fail:
        severity = "HIGH"
    elif any_warn:
        severity = "LOW"

    if any_fail:
        diagnosis = (
            "Hypothesis fails one or more hard cross-checks. Reject or "
            "refine before any human review — the cited contradictions "
            "point to either a malformed proposal or a corpus "
            "inconsistency that itself needs auditing."
        )
    elif any_warn:
        diagnosis = (
            "Hypothesis passes hard checks (dimensional analysis, "
            "reference resolution) but its limit / conservation claims "
            "have not been formally verified. Human reviewer or symbolic "
            "engine (SymPy/PySR) should close the open warnings before "
            "promotion to a verified card."
        )
    else:
        diagnosis = (
            "All declared cross-checks pass. The hypothesis is internally "
            "consistent and resolvable against the corpus — it is a "
            "candidate for human promotion to a verified card."
        )

    return EvaluateResult(
        checks=checks,
        diagnosis=diagnosis,
        overall=EvaluateOverall(passing=passing, total=total, severity=severity),
    )


# ---------------------------------------------------------------------------
# Individual checks (private — exposed via run_hypothesis_checks)
# ---------------------------------------------------------------------------


def _check_dimensional(spec: DimensionalCheckSpec) -> UsceCheck:
    # When the card supplies the formula (`expr`) and per-symbol dimensions
    # (`symbols`), derive the RHS dimensions from the formula itself and check
    # them against `lhsDims` — verifying the equation, not just the author's
    # declared `rhsDims`. Anything non-derivable falls back to the declared
    # comparison so we never emit a fabricated verdict.
    if spec.expr and spec.symbols:
        try:
            derived = derive_dims(spec.expr, spec.symbols)
        except DerivationError as exc:
            return _declared_dimensional(
                spec,
                note=f" (formula not derivable — {exc}; compared declared vectors)",
            )
        if dims_equal(spec.lhsDims, derived):
            return UsceCheck(
                name="Hypothesis.dimensional_analysis",
                severity="pass",
                detail=(
                    f"Derived from formula: {spec.rhsLabel} = "
                    f"{stringify_dims(derived)} matches LHS [{spec.lhsLabel}] = "
                    f"{stringify_dims(spec.lhsDims)}"
                ),
            )
        return UsceCheck(
            name="Hypothesis.dimensional_analysis",
            severity="fail",
            detail=(
                f"Dimensional mismatch — the formula {spec.rhsLabel} derives to "
                f"{stringify_dims(derived)}, but LHS [{spec.lhsLabel}] is "
                f"{stringify_dims(spec.lhsDims)}. The proposed equation does not "
                f"hold dimensionally."
            ),
        )
    return _declared_dimensional(spec)


def _declared_dimensional(spec: DimensionalCheckSpec, note: str = "") -> UsceCheck:
    if dims_equal(spec.lhsDims, spec.rhsDims):
        return UsceCheck(
            name="Hypothesis.dimensional_analysis",
            severity="pass",
            detail=(
                f"LHS [{spec.lhsLabel}] = {stringify_dims(spec.lhsDims)} "
                f"matches RHS [{spec.rhsLabel}] = {stringify_dims(spec.rhsDims)}{note}"
            ),
        )
    return UsceCheck(
        name="Hypothesis.dimensional_analysis",
        severity="fail",
        detail=(
            f"Dimensional mismatch — LHS {stringify_dims(spec.lhsDims)} vs "
            f"RHS {stringify_dims(spec.rhsDims)}. The proposed equation is "
            f"not even a candidate without a missing factor.{note}"
        ),
    )


def _check_reference_corpus(
    spec: ReferenceCorpusCheckSpec,
    corpus: Sequence[Card],
) -> UsceCheck:
    known = {c.id for c in corpus}
    must = spec.mustAgreeWith or []
    may = spec.mayContradict or []
    missing_must = [card_id for card_id in must if card_id not in known]
    missing_may = [card_id for card_id in may if card_id not in known]
    all_missing = missing_must + missing_may

    if all_missing:
        return UsceCheck(
            name="Hypothesis.reference_corpus",
            severity="fail",
            detail=(
                f"Declared reference cards not in corpus: "
                f"{', '.join(all_missing)}. Hypothesis cannot be "
                f"cross-checked against missing references."
            ),
        )

    must_list = ", ".join(must) if must else "∅"
    may_list = ", ".join(may) if may else "∅"
    return UsceCheck(
        name="Hypothesis.reference_corpus",
        severity="pass",
        detail=(
            f"All declared references resolve — "
            f"{len(must)} mustAgreeWith ({must_list}), "
            f"{len(may)} mayContradict ({may_list})."
        ),
    )


def _check_limit(spec: LimitCheckSpec, corpus: Sequence[Card]) -> UsceCheck:
    known_ids = {c.id for c in corpus}
    reduces_to_card = spec.expectedReducesTo in known_ids
    if reduces_to_card:
        detail = (
            f"Claim recorded: in the regime {spec.regime}, the proposal "
            f'should reduce to "{spec.expectedReducesTo}" (corpus card). '
            f"Symbolic verification pending."
        )
    else:
        detail = (
            f"Claim recorded: in the regime {spec.regime}, the proposal "
            f"should reduce to {spec.expectedReducesTo}. Symbolic "
            f"verification pending."
        )
    return UsceCheck(
        name=f"Hypothesis.limit_{spec.name}",
        severity="warn",
        detail=detail,
    )


def _check_conservation_law(spec: ConservationLawSpec) -> UsceCheck:
    return UsceCheck(
        name=f"Hypothesis.conservation_{spec.law}",
        severity="warn",
        detail=(
            f"Claim recorded: {spec.law} conservation — {spec.statement}. "
            f"Symbolic / numeric verification pending."
        ),
    )


def _check_derived_from(spec: DerivedFrom, corpus: Sequence[Card]) -> UsceCheck:
    known = {c.id for c in corpus}
    if spec.cardId not in known:
        return UsceCheck(
            name="Hypothesis.derived_from",
            severity="fail",
            detail=(
                f"Hypothesis declares it {spec.relationship} card "
                f'"{spec.cardId}", which is not in the corpus.'
            ),
        )
    return UsceCheck(
        name="Hypothesis.derived_from",
        severity="pass",
        detail=(
            f'Hypothesis {spec.relationship} corpus card "{spec.cardId}" '
            f"— link resolves."
        ),
    )


__all__ = [
    "run_hypothesis_checks",
]
