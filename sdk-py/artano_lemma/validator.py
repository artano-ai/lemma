# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""JSON Schema validation against ``../schema/card.v0.1.json``.

The Pydantic models in :mod:`artano_lemma.types` are a hand-written
projection of the same schema. The schema is the authority; the
Pydantic models exist for typed Python ergonomics. This module wraps
the schema for cases where:

* a caller wants to validate a raw payload before parsing it (e.g.
  card-authoring tools that need precise error reporting),
* a contributor wants to confirm a candidate JSON file is shaped
  correctly without round-tripping through Pydantic,
* the loader wants to surface schema-violation errors with the
  specific JSON-pointer the validator complains about, not just a
  Pydantic ``ValidationError`` summary.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema
from jsonschema import Draft202012Validator
from pydantic import TypeAdapter, ValidationError

from .types import Card


PACKAGE_DIR = Path(__file__).resolve().parent
LEMMA_ROOT = PACKAGE_DIR.parent.parent  # editable / source install
_BUNDLED_SCHEMA = PACKAGE_DIR / "_schema" / "card.v0.1.json"
_REPO_SCHEMA = LEMMA_ROOT / "schema" / "card.v0.1.json"
# Prefer the schema bundled in the installed wheel; fall back to the repo.
DEFAULT_SCHEMA_PATH = _BUNDLED_SCHEMA if _BUNDLED_SCHEMA.exists() else _REPO_SCHEMA


# ---------------------------------------------------------------------------
# Cached validator loader
# ---------------------------------------------------------------------------


# The four card-kind discriminator literals → corresponding $defs entry.
_KIND_TO_DEF = {
    "principle": "PrincipleCard",
    "ops": "OpsCard",
    "hypothesis": "HypothesisCard",
    "unidentified": "UnidentifiedCard",
}


@lru_cache(maxsize=4)
def _schema_for(schema_path: Path) -> dict[str, Any]:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return schema


@lru_cache(maxsize=4)
def _validator_for(schema_path: Path) -> Draft202012Validator:
    return Draft202012Validator(_schema_for(schema_path))


@lru_cache(maxsize=16)
def _variant_validator(schema_path: Path, kind: str) -> Draft202012Validator:
    """Return a validator that targets one specific card-kind sub-schema.

    Used when the payload already declares a known ``kind`` so the
    error message can reference the missing field inside the variant
    instead of the unhelpful "not valid under any of the given
    schemas" that a ``oneOf`` top-level emits.
    """
    if kind not in _KIND_TO_DEF:
        raise KeyError(f"unknown card kind {kind!r}")
    full = _schema_for(schema_path)
    variant_def = full["$defs"][_KIND_TO_DEF[kind]]
    # Compose a self-contained schema that references the same $defs so
    # any internal $ref (e.g. HypothesisCard → HypothesisChecksSpec) still
    # resolves.
    composed: dict[str, Any] = {
        "$schema": full.get("$schema", "https://json-schema.org/draft/2020-12/schema"),
        **variant_def,
        "$defs": full.get("$defs", {}),
    }
    Draft202012Validator.check_schema(composed)
    return Draft202012Validator(composed)


def get_validator(schema_path: Path | None = None) -> Draft202012Validator:
    """Return the cached jsonschema validator for the canonical schema.

    Pass an explicit ``schema_path`` to validate against a different
    schema (e.g. a future v0.2 draft, a private fork). Default points
    at ``lemma/schema/card.v0.1.json``.
    """
    path = (schema_path or DEFAULT_SCHEMA_PATH).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Card schema not found at {path}.")
    return _validator_for(path)


# ---------------------------------------------------------------------------
# Public surface
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ValidationIssue:
    """One thing the validator complained about."""

    path: str
    """JSON-pointer-style path inside the payload, e.g. ``/checks/dimensional/lhsDims``."""

    message: str
    """Human-readable explanation of the violation."""


class CardValidationError(ValueError):
    """Raised when a payload fails JSON Schema validation.

    The :attr:`issues` list contains one :class:`ValidationIssue` per
    distinct schema violation. The :attr:`payload_path` is the source
    file path when validation was triggered from the loader, or
    ``None`` for ad-hoc validation of an in-memory payload.
    """

    def __init__(
        self,
        issues: list[ValidationIssue],
        *,
        payload_path: Path | None = None,
    ) -> None:
        self.issues = list(issues)
        self.payload_path = payload_path
        location = f" at {payload_path}" if payload_path else ""
        summary = f"{len(issues)} schema violation{'s' if len(issues) != 1 else ''}{location}"
        if issues:
            preview = "; ".join(f"{i.path or '/'}: {i.message}" for i in issues[:3])
            summary = f"{summary} — {preview}"
            if len(issues) > 3:
                summary = f"{summary}; ..."
        super().__init__(summary)


def validate_card_payload(
    payload: dict[str, Any],
    *,
    schema_path: Path | None = None,
    source_path: Path | None = None,
) -> None:
    """Validate ``payload`` against the canonical Lemma schema.

    If the payload declares a known ``kind``, validation targets the
    matching variant directly so the error messages reference the
    missing/invalid field inside that variant. If ``kind`` is missing
    or unknown, fall back to validating against the full ``oneOf``.

    Raises :class:`CardValidationError` if the payload doesn't match,
    with one :class:`ValidationIssue` per violation. Returns
    ``None`` on success.

    :param payload: parsed JSON object to validate
    :param schema_path: optional override for the schema location
    :param source_path: source file the payload was read from, surfaced
        in the error message if validation fails
    """
    path = (schema_path or DEFAULT_SCHEMA_PATH).resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Card schema not found at {path}.")

    kind = payload.get("kind") if isinstance(payload, dict) else None
    if isinstance(kind, str) and kind in _KIND_TO_DEF:
        validator = _variant_validator(path, kind)
    else:
        validator = _validator_for(path)

    errors = sorted(validator.iter_errors(payload), key=lambda e: list(e.absolute_path))
    if not errors:
        return
    issues = [
        ValidationIssue(
            path="/" + "/".join(str(p) for p in err.absolute_path),
            message=err.message,
        )
        for err in errors
    ]
    raise CardValidationError(issues, payload_path=source_path)


def is_valid_card_payload(
    payload: dict[str, Any],
    *,
    schema_path: Path | None = None,
) -> bool:
    """Cheap boolean check. Returns ``True`` iff the payload validates."""
    try:
        get_validator(schema_path).validate(payload)
    except jsonschema.ValidationError:
        return False
    return True


# ---------------------------------------------------------------------------
# Parse-and-validate convenience
# ---------------------------------------------------------------------------


_CARD_ADAPTER: TypeAdapter[Card] = TypeAdapter(Card)


def parse_card(
    payload: dict[str, Any],
    *,
    schema_path: Path | None = None,
    source_path: Path | None = None,
) -> Card:
    """Validate the payload against the JSON Schema *and* the Pydantic
    discriminated union, then return the typed card.

    JSON Schema validation runs first so the error messages reference
    the canonical schema's JSON-pointer paths (e.g.
    ``/checks/dimensional/lhsDims``) rather than Pydantic's
    field-name style. If schema validation passes but Pydantic still
    rejects (typically a discriminator the schema declared as a
    ``const`` but the JSON has subtly wrong), the underlying
    ``pydantic.ValidationError`` propagates with the source path
    attached as a note.
    """
    validate_card_payload(payload, schema_path=schema_path, source_path=source_path)
    try:
        return _CARD_ADAPTER.validate_python(payload)
    except ValidationError as exc:
        if source_path is not None:
            exc.add_note(f"source file: {source_path}")
        raise


__all__ = [
    "ValidationIssue",
    "CardValidationError",
    "validate_card_payload",
    "is_valid_card_payload",
    "parse_card",
    "get_validator",
    "DEFAULT_SCHEMA_PATH",
]
