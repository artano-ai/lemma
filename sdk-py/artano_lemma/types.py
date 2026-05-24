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
# PrincipleCard
# ---------------------------------------------------------------------------


ValidationEnvelopeValue = Union[tuple[float, float], dict[str, Any]]


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


# ---------------------------------------------------------------------------
# HypothesisCard + its checks spec
# ---------------------------------------------------------------------------


class DimensionalCheckSpec(BaseModel):
    model_config = _StrictConfig

    lhsLabel: str
    lhsDims: DimVec
    rhsLabel: str
    rhsDims: DimVec


class LimitCheckSpec(BaseModel):
    model_config = _StrictConfig

    name: str
    regime: str
    expectedReducesTo: str


ConservationLaw = Literal[
    "energy",
    "momentum",
    "charge",
    "particle-number",
    "total-spin",
    "parity",
]


class ConservationLawSpec(BaseModel):
    model_config = _StrictConfig

    law: ConservationLaw
    statement: str


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
