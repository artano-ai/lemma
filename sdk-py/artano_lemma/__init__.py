"""Lemma — open verification substrate for AI-generated scientific code.

Python SDK. Parallel to the Node distribution at
``../mcp-server/`` (``@artano-ai/mcp-server``). Both speak the same
cards format, the same check verdicts, and the same Model Context
Protocol tools.

Public surface:

* **Typed card models** —
  :class:`Card` (discriminated union),
  :class:`PrincipleCard`, :class:`OpsCard`, :class:`HypothesisCard`,
  :class:`UnidentifiedCard`, plus the spec sub-types
  (:class:`DimVec`, :class:`HypothesisChecksSpec`, …).
* **Corpus access** — :func:`load_cards`, :func:`iter_cards`,
  :func:`find_card`, :func:`filter_cards`, :func:`domains`,
  :func:`cards_root`.
* **Schema validation** — :func:`validate_card_payload`,
  :func:`is_valid_card_payload`, :func:`parse_card`,
  :class:`CardValidationError`.
* **Engine output types** — :class:`UsceCheck`,
  :class:`EvaluateResult`, :data:`CheckSeverity`.

The cross-check engine and the MCP client / server live in
submodules and are work in progress; for production verification
today, prefer the Node MCP server at ``../mcp-server/``.
"""

from .cards import (
    CARDS_DIR,
    SCHEMA_PATH,
    CardsLoadError,
    LoadFailure,
    cards_root,
    domains,
    filter_cards,
    find_card,
    iter_cards,
    load_cards,
    load_cards_with_failures,
)
from .client import (
    LemmaClient,
    LemmaToolError,
    connect_lemma_session,
    connect_lemma_stdio,
)
from .dimensional import (
    AXES,
    DerivationError,
    derive_dims,
    dims_equal,
    is_dimensionless,
    stringify_dims,
)
from .engine import run_hypothesis_checks
from .tools import (
    cards_get,
    cards_list,
    hypothesis_crosscheck,
    ops_get,
)
from .types import (
    Card,
    CheckSeverity,
    ConservationLaw,
    ConservationLawSpec,
    DerivedFrom,
    DimensionalCheckSpec,
    DimVec,
    EvaluateOverall,
    EvaluateResult,
    HypothesisCard,
    HypothesisChecksSpec,
    HypothesisOrigin,
    LimitCheckSpec,
    OpsCard,
    OpsParameter,
    OverallSeverity,
    PrincipleCard,
    ReferenceCorpusCheckSpec,
    UnidentifiedCard,
    UsceCheck,
    ValidationEnvelopeValue,
)
from .validator import (
    CardValidationError,
    ValidationIssue,
    is_valid_card_payload,
    parse_card,
    validate_card_payload,
)
from .version import __version__

__all__ = [
    # version
    "__version__",
    # card models
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
    # output types
    "UsceCheck",
    "EvaluateOverall",
    "EvaluateResult",
    "CheckSeverity",
    "OverallSeverity",
    # corpus access
    "cards_root",
    "load_cards",
    "load_cards_with_failures",
    "iter_cards",
    "find_card",
    "filter_cards",
    "domains",
    "CardsLoadError",
    "LoadFailure",
    "CARDS_DIR",
    "SCHEMA_PATH",
    # schema validation
    "validate_card_payload",
    "is_valid_card_payload",
    "parse_card",
    "CardValidationError",
    "ValidationIssue",
    # dimensional algebra
    "AXES",
    "DerivationError",
    "derive_dims",
    "dims_equal",
    "stringify_dims",
    "is_dimensionless",
    # engine
    "run_hypothesis_checks",
    # tools (pure-Python implementations of the MCP tool surface)
    "cards_list",
    "cards_get",
    "ops_get",
    "hypothesis_crosscheck",
    # MCP client
    "LemmaClient",
    "LemmaToolError",
    "connect_lemma_stdio",
    "connect_lemma_session",
]
