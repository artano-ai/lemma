# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Typed card schemas.

Pydantic v2 mirror of the canonical JSON Schema at
``../schema/card.v0.1.json`` and of the hand-typed TypeScript
projection at ``../mcp-server/src/cards/types.ts``.

A card is a discriminated union on ``kind`` — one of four
structural variants:

* :class:`PrincipleCard` — a peer-recognisable scientific principle
  (the structural shape used for physics, chemistry, biology,
  climate, mathematics, engineering, numerical methods).
* :class:`OpsCard` — a parameterised computational protocol.
* :class:`HypothesisCard` — an AI- or human-proposed extension to
  the corpus, awaiting verification.
* :class:`UnidentifiedCard` — sentinel returned by the IDENTIFY
  phase when no card honestly matches the request.

The discriminator is *structural*, not subject-area: a chemistry
card and a condensed-matter physics card are both ``PrincipleCard``;
the subject area lives in :attr:`PrincipleCard.domain`.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Common config — every card model rejects unknown fields, matching the
# JSON Schema's ``"additionalProperties": false`` on every variant.
# ---------------------------------------------------------------------------

_StrictConfig = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Primitive: DimVec
# ---------------------------------------------------------------------------


class DimVec(BaseModel):
    """Canonical dimension vector.

    Each axis is an integer exponent on a primitive dimension. Omitted
    axes default to zero. The seven axes are length, time, mass,
    energy, charge, temperature, count.
    """

    model_config = _StrictConfig

    L: int = 0
    T: int = 0
    M: int = 0
    E: int = 0
    Q: int = 0
    Theta: int = 0
    N: int = 0

    def as_dict(self) -> dict[str, int]:
        """Return the non-zero axes as a plain dict."""
        return {axis: getattr(self, axis) for axis in ("L", "T", "M", "E", "Q", "Theta", "N") if getattr(self, axis) != 0}


# ---------------------------------------------------------------------------
# Metadata — optional authorship and quality-tier block
# ---------------------------------------------------------------------------


class Author(BaseModel):
    """An author, curator, or reviewer of a card."""

    model_config = _StrictConfig

    name: str
    orcid: str | None = None
    github: str | None = None
    role: Literal["author", "curator", "reviewer", "translator", "maintainer"] | None = None


class CardMetadata(BaseModel):
    """Optional metadata block present on backfilled corpus cards."""

    model_config = _StrictConfig

    authors: list[Author]
    tier: Literal["bronze", "silver", "gold"] | None = None
    created: str | None = None
    updated: str | None = None


# ---------------------------------------------------------------------------
# PrincipleCard
# ---------------------------------------------------------------------------


ValidationEnvelopeValue = Union[tuple[float, float], dict[str, Any]]


class CrossMethodTolerance(BaseModel):
    """How closely independent methods must agree on one observable.

    Distinct from a validation envelope: an envelope bounds *one* run's
    value absolutely, this bounds the *spread between* runs. Exactly one
    of ``relative`` (fractional, about the mean) or ``absolute`` (in the
    observable's own unit) is set. ``gating`` false means the observable
    is compared and reported but does not decide the verdict — for
    quantities whose divergence diagnoses a method rather than
    invalidating the comparison. ``basis`` records why the number is what
    it is, so a tolerance is never an unexplained constant.
    """

    model_config = _StrictConfig

    relative: float | None = None
    absolute: float | None = None
    gating: bool = True
    basis: str | None = None


class MachineFormula(BaseModel):
    """Machine-readable form of ``formulaTeX``.

    ``formulaTeX`` stays the human-facing statement — it carries presentational
    LaTeX (``\\tfrac``, ``\\,``) that is not semantic. This is what a program
    evaluates, in the same grammar the dimensional check already uses, so the
    corpus has one expression language rather than two.

    Required before a limit claim can name this card as what it reduces to.
    """

    model_config = _StrictConfig

    expr: str
    symbols: dict[str, DimVec]
    #: What `expr` actually encodes. Required because it need NOT be a
    #: transcription of ``formulaTeX`` — a card may state the integrated form
    #: for a human and the differential form for a machine. Without it a
    #: consumer assumes they are the same relation and compares two
    #: expressions that were never meant to match.
    relation: str


class Comparison(BaseModel):
    """A single ``quantity op value`` test."""

    model_config = _StrictConfig

    of: str
    op: Literal["<", "<=", ">", ">="]
    value: float


class SeriesConditionSpec(BaseModel):
    """A condition every reported sample of a quantity must satisfy.

    Structured rather than an expression: an expression language would need a
    computer-algebra system, which would make the check Python-only like the
    symbolic adapter. Every such claim in the corpus fits this shape.

    ``where`` is load-bearing, not a nicety — ``Im chi_0(omega > 0) <= 0`` says
    nothing about negative frequencies, where Im chi is legitimately positive,
    so testing outside the declared domain would manufacture a violation the
    card never asserted.
    """

    model_config = _StrictConfig

    of: str
    op: Literal["<", "<=", ">", ">="]
    value: float
    where: Comparison | None = None
    basis: str | None = None


class ConvergenceSpec(BaseModel):
    """Qualifies how a claimed convergence order is measured.

    Exists because the engine was otherwise deciding a verdict with a number of
    its own: ``maxPerLevelSpread`` separates "this refinement study is not a
    clean power law" (``warn``) from "the method converges at the wrong rate"
    (``fail``). A number that flips a verdict belongs in the card with its
    reasoning — the same argument that gives :class:`CrossMethodTolerance` a
    ``basis``.
    """

    model_config = _StrictConfig

    orderKey: str | None = None
    maxPerLevelSpread: float | None = None
    basis: str | None = None


class PrincipleCard(BaseModel):
    """A peer-recognisable scientific principle.

    Used for physics, chemistry, biology, climate, mathematics,
    engineering, numerical methods. The ``domain`` field carries the
    subject area; the shape is universal.
    """

    model_config = _StrictConfig

    kind: Literal["principle"]
    id: str
    version: str
    name: str
    domain: str | None = None
    principles: list[str]
    formulaTeX: str
    conventions: list[str]
    expectedLimits: list[str]
    references: list[str]
    validationEnvelopes: dict[str, ValidationEnvelopeValue] | None = None
    crossMethodTolerances: dict[str, CrossMethodTolerance] | None = None
    formula: MachineFormula | None = None
    convergence: ConvergenceSpec | None = None
    seriesConditions: list[SeriesConditionSpec] | None = None
    metadata: CardMetadata | None = None


# ---------------------------------------------------------------------------
# OpsCard
# ---------------------------------------------------------------------------


class OpsParameter(BaseModel):
    model_config = _StrictConfig

    key: str
    label: str
    defaultValue: str
    required: bool
    note: str | None = None


class OpsCard(BaseModel):
    """A parameterised computational protocol.

    Job-submission templates (SLURM, Snakemake), Singularity recipes,
    and similar parameterised scripts. Each ``parameters[]`` entry
    declares one knob the protocol exposes.
    """

    model_config = _StrictConfig

    kind: Literal["ops"]
    id: str
    version: str
    name: str
    description: str
    parameters: list[OpsParameter]
    validation: list[str]
    references: list[str]
    metadata: CardMetadata | None = None


# ---------------------------------------------------------------------------
# HypothesisCard + its checks spec
# ---------------------------------------------------------------------------


class DimensionalCheckSpec(BaseModel):
    model_config = _StrictConfig

    lhsLabel: str
    lhsDims: DimVec
    rhsLabel: str
    rhsDims: DimVec
    expr: str | None = None
    symbols: dict[str, DimVec] | None = None


class LimitPoint(BaseModel):
    """Machine form of a limiting process.

    Only present when the regime genuinely *is* a limit. A substitution
    (``y = 0``) is a different operation and must not be expressed here —
    the two differ wherever the limit and the value disagree.
    """

    model_config = _StrictConfig

    symbol: str
    to: str  # '0', 'oo', '-oo', or a numeric literal


class SolveForSpec(BaseModel):
    """Machine form of a regime that asks for a **root**, not a limit.

    Terminal velocity is the ``v`` at which the net force vanishes — a root of
    ``expr = 0`` — not the limit of the force expression as ``t -> infinity``.
    Different machinery, and expressing it as a limit gives the wrong answer.
    """

    model_config = _StrictConfig

    symbol: str


class SystemEquation(BaseModel):
    """One equation of a coupled system, vanishing at a fixed point."""

    model_config = _StrictConfig

    of: str  # which quantity this governs, e.g. 'x' for dx/dt
    expr: str


class FixedPointSpec(BaseModel):
    """Machine form of a regime naming a **stationary point of a system**.

    Distinct from :class:`SolveForSpec`, which roots a single expression: a
    fixed point of a two-equation system cannot be found from one equation.
    The system is declared here rather than assumed, so the claim is
    self-contained and auditable — a reader can see exactly which equations
    were solved.
    """

    model_config = _StrictConfig

    system: list[SystemEquation]
    solveFor: list[str]
    # Names the system introduces beyond the hypothesis's own declared symbols.
    # Declared, not inferred: `gamma`, `beta`, `zeta`, `lambda` and `pi` are all
    # functions or constants in SymPy's namespace, and an unbound collision
    # computes a different expression than the card declared.
    parameters: list[str] = []
    # Inequalities selecting WHICH fixed point is claimed. A coupled system
    # usually has several, and stationarity alone would accept an extinction
    # point for a claim about coexistence.
    conditions: list[str] = []


class LimitTarget(BaseModel):
    """Machine form of what a limit should reduce to.

    Either another corpus card — which must then declare ``formula`` — or an
    inline expression for targets that are not themselves cards.
    """

    model_config = _StrictConfig

    cardId: str | None = None
    expr: str | None = None
    # A fixed point is a tuple, not a single expression, so it needs its own
    # form: symbol -> expression, every entry of which must match.
    point: dict[str, str] | None = None


class LimitCheckSpec(BaseModel):
    model_config = _StrictConfig

    name: str
    regime: str
    expectedReducesTo: str
    # Optional machine forms of `regime`. At most one — a claim carrying two is
    # ambiguous rather than richer. Absent means the claim stays
    # recorded-not-discharged, which is the v1 behaviour.
    #
    # `limits[]` historically held three different operations under one name:
    # a genuine limit, a substitution, and a root. They are separated here
    # because they are not interchangeable — a substitution and a limit
    # disagree wherever the function is discontinuous at the point.
    limit: LimitPoint | None = None
    substitute: dict[str, str] | None = None
    solveFor: SolveForSpec | None = None
    fixedPoint: FixedPointSpec | None = None
    target: LimitTarget | None = None


# Which quantity a conservation claim is about. Free-form, exactly as ``domain``
# is: a closed enum here was a physics-only vocabulary, and the corpus showed it
# breaking — ``lotka-volterra-with-logistic-prey`` is a population-dynamics card
# that had to declare ``law="energy"`` for a Lyapunov function, so its own
# statement opened "No conserved energy-like quantity." A type that forces a card
# to mislabel itself is the domain-agnostic rule failing in a place the
# "no constants in the engine" check does not look.
ConservationLaw = str

#: Conventional values, for tooling and authoring hints. NOT a constraint — the
#: point of widening was that the list cannot be closed across every domain.
CONVENTIONAL_CONSERVATION_LAWS: tuple[str, ...] = (
    "energy",
    "momentum",
    "charge",
    "particle-number",
    "total-spin",
    "parity",
    "mass",
    "probability",
    "lyapunov-function",
)


class EvolutionSpec(BaseModel):
    """Machine form of how a declared quantity evolves under the system.

    ``rate`` of ``"0"`` is genuine conservation. A non-zero rate is a
    *dissipation* claim — which is what the corpus actually asserts in both
    cards that carry a conservation law: mechanical energy under linear drag,
    and a Lyapunov function under logistic predation. A checker that only tested
    "does the derivative vanish" would have covered neither.
    """

    model_config = _StrictConfig

    quantity: str
    system: list[SystemEquation]
    rate: str
    parameters: list[str] = []


class ConservationLawSpec(BaseModel):
    model_config = _StrictConfig

    law: ConservationLaw
    statement: str
    evolution: EvolutionSpec | None = None


class ReferenceCorpusCheckSpec(BaseModel):
    model_config = _StrictConfig

    mustAgreeWith: list[str] | None = None
    mayContradict: list[str] | None = None


class HypothesisChecksSpec(BaseModel):
    """The cross-checks the engine must run on a HypothesisCard."""

    model_config = _StrictConfig

    dimensional: DimensionalCheckSpec | None = None
    limits: list[LimitCheckSpec] | None = None
    conservationLaws: list[ConservationLawSpec] | None = None
    referenceCorpus: ReferenceCorpusCheckSpec | None = None


class DerivedFrom(BaseModel):
    model_config = _StrictConfig

    cardId: str
    relationship: Literal["extends", "replaces", "complements"]


HypothesisOrigin = Literal["llm", "human", "symbolic-regression"]


class HypothesisCard(BaseModel):
    """An AI- or human-proposed extension to the corpus.

    Explicitly marked as *not yet verified*. The cross-check engine
    consumes :attr:`checks` to decide whether the hypothesis can be
    promoted to a :class:`PrincipleCard`.
    """

    model_config = _StrictConfig

    kind: Literal["hypothesis"]
    id: str
    version: str
    name: str
    proposal: str
    proposedFormulaTeX: str
    derivedFrom: DerivedFrom | None = None
    checks: HypothesisChecksSpec
    references: list[str]
    origin: HypothesisOrigin
    rationale: str | None = None
    metadata: CardMetadata | None = None


# ---------------------------------------------------------------------------
# UnidentifiedCard
# ---------------------------------------------------------------------------


class UnidentifiedCard(BaseModel):
    """Sentinel returned by the IDENTIFY phase when no card honestly
    matches the request. Surfaced verbatim instead of fabricating a
    fallback."""

    model_config = _StrictConfig

    kind: Literal["unidentified"]
    id: Literal["none"]
    version: Literal["0.0.0"]
    name: str
    reason: str


# ---------------------------------------------------------------------------
# The discriminated union
# ---------------------------------------------------------------------------


Card = Annotated[
    Union[PrincipleCard, OpsCard, HypothesisCard, UnidentifiedCard],
    Field(discriminator="kind"),
]
"""A Lemma card. Discriminated on ``kind``."""


# ---------------------------------------------------------------------------
# Output types — what the engine emits about a candidate.
# ---------------------------------------------------------------------------


CheckSeverity = Literal["pass", "warn", "fail"]
OverallSeverity = Literal["NONE", "LOW", "MEDIUM", "HIGH"]


class UsceCheck(BaseModel):
    """One named check the engine ran, with its verdict."""

    model_config = _StrictConfig

    name: str
    severity: CheckSeverity
    detail: str


class EvaluateOverall(BaseModel):
    model_config = _StrictConfig

    passing: int
    total: int
    severity: OverallSeverity


class EvaluateResult(BaseModel):
    """Aggregated result of running the engine against one candidate.

    Per-check severity verdicts plus a roll-up. The shape is
    deliberately deterministic — the engine does not return a single
    scalar score.
    """

    model_config = _StrictConfig

    checks: list[UsceCheck]
    diagnosis: str
    overall: EvaluateOverall


__all__ = [
    "Author",
    "CardMetadata",
    "Card",
    "PrincipleCard",
    "OpsCard",
    "OpsParameter",
    "HypothesisCard",
    "HypothesisChecksSpec",
    "DimensionalCheckSpec",
    "LimitCheckSpec",
    "ConservationLawSpec",
    "ConservationLaw",
    "CONVENTIONAL_CONSERVATION_LAWS",
    "ReferenceCorpusCheckSpec",
    "DerivedFrom",
    "HypothesisOrigin",
    "UnidentifiedCard",
    "DimVec",
    "ValidationEnvelopeValue",
    "UsceCheck",
    "EvaluateOverall",
    "EvaluateResult",
    "CheckSeverity",
    "OverallSeverity",
]
