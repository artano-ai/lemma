# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Loader for the Lemma cards corpus.

Resolves the cards directory bundled at ``lemma/cards/`` relative to
this SDK and parses each JSON file into the typed discriminated union
:class:`artano_lemma.types.Card`.

Every card is JSON-Schema-validated (against
``../schema/card.v0.1.json``) before being parsed; the loader fails
loudly with the offending file path and the specific
JSON-pointer-style violation, rather than silently skipping or
crashing with a bare ``KeyError``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator

from .types import Card, OpsCard, PrincipleCard, HypothesisCard, UnidentifiedCard
from .validator import (
    CardValidationError,
    parse_card,
)


PACKAGE_DIR = Path(__file__).resolve().parent
# sdk-py/artano_lemma/ → sdk-py/ → lemma/
LEMMA_ROOT = PACKAGE_DIR.parent.parent
CARDS_DIR = LEMMA_ROOT / "cards"
SCHEMA_PATH = LEMMA_ROOT / "schema" / "card.v0.1.json"


def cards_root() -> Path:
    """Return the resolved cards/ directory used by the default loader."""
    return CARDS_DIR


# ---------------------------------------------------------------------------
# Per-file load result
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoadFailure:
    """A card file the loader could not parse.

    Surfaced by :func:`load_cards` when ``strict=False``; aggregated
    into a :class:`CardsLoadError` when ``strict=True`` (the default).
    """

    path: Path
    """Source JSON file that failed to load."""

    error: Exception
    """The exception raised. Typically a :class:`CardValidationError`,
    a :class:`pydantic.ValidationError`, or a ``json.JSONDecodeError``."""


class CardsLoadError(RuntimeError):
    """Raised when one or more cards in the corpus failed to load.

    The :attr:`failures` list has one :class:`LoadFailure` per bad
    card. The :attr:`loaded` list has the cards that did parse
    successfully — useful for resilient consumers that want to keep
    the corpus partially usable.
    """

    def __init__(self, failures: list[LoadFailure], loaded: list[Card]) -> None:
        self.failures = list(failures)
        self.loaded = list(loaded)
        summary_lines = [
            f"{len(failures)} card{'s' if len(failures) != 1 else ''} failed to load:"
        ]
        for f in failures[:5]:
            summary_lines.append(f"  - {f.path}: {f.error}")
        if len(failures) > 5:
            summary_lines.append(f"  ... and {len(failures) - 5} more")
        super().__init__("\n".join(summary_lines))


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------


def load_cards(
    directory: Path | None = None,
    *,
    strict: bool = True,
) -> list[Card]:
    """Load every card under ``directory`` (default: bundled
    ``lemma/cards/``) and return them as typed objects.

    Each file is validated against the canonical JSON Schema and then
    parsed into the typed discriminated union :class:`Card`.

    :param directory: directory to walk for ``*.json`` cards.
    :param strict: if ``True`` (the default) and any file fails to
        validate, raise :class:`CardsLoadError` aggregating every
        failure. If ``False``, log nothing and return only the cards
        that parsed; use :func:`load_cards_with_failures` if you need
        the failure list.
    """
    cards, failures = _walk_and_parse(directory or CARDS_DIR)
    if strict and failures:
        raise CardsLoadError(failures, cards)
    return cards


def load_cards_with_failures(
    directory: Path | None = None,
) -> tuple[list[Card], list[LoadFailure]]:
    """Like :func:`load_cards` but always returns both lists.

    Useful in CI / authoring tools where you want to surface every
    failure but keep going with the cards that did work.
    """
    return _walk_and_parse(directory or CARDS_DIR)


def iter_cards(directory: Path | None = None) -> Iterable[Card]:
    """Yield cards one at a time. Strict — raises on the first bad file."""
    target = (directory or CARDS_DIR)
    if not target.is_dir():
        raise FileNotFoundError(
            f"Cards directory not found: {target}. "
            "The Python SDK expects cards/ to live at the lemma/ root."
        )
    for entry in _iter_json_files(target):
        payload = _read_json(entry)
        yield parse_card(payload, source_path=entry)


# ---------------------------------------------------------------------------
# Public helpers — filter / find
# ---------------------------------------------------------------------------


def find_card(card_id: str, cards: Iterable[Card] | None = None) -> Card | None:
    """Return the card whose ``id`` matches, or ``None``.

    If ``cards`` is omitted, the bundled corpus is loaded.
    """
    pool = list(cards) if cards is not None else load_cards()
    for c in pool:
        if c.id == card_id:
            return c
    return None


def filter_cards(
    cards: Iterable[Card] | None = None,
    *,
    kind: str | None = None,
    domain: str | None = None,
    domain_prefix: str | None = None,
) -> list[Card]:
    """Filter the corpus on common predicates.

    :param kind: exact match on ``card.kind`` (e.g. ``"principle"``).
    :param domain: exact match on ``card.domain`` (only meaningful for
        :class:`PrincipleCard` — non-principle cards have no domain
        and never match).
    :param domain_prefix: substring-prefix match on
        ``card.domain`` (e.g. ``"physics-"``).
    """
    pool = list(cards) if cards is not None else load_cards()
    out: list[Card] = []
    for c in pool:
        if kind is not None and c.kind != kind:
            continue
        if domain is not None or domain_prefix is not None:
            card_domain = getattr(c, "domain", None)
            if domain is not None and card_domain != domain:
                continue
            if domain_prefix is not None and not (
                isinstance(card_domain, str) and card_domain.startswith(domain_prefix)
            ):
                continue
        out.append(c)
    return out


def domains(cards: Iterable[Card] | None = None) -> list[str]:
    """Return the sorted, deduplicated list of declared domains.

    Only :class:`PrincipleCard` has a ``domain`` field; other variants
    contribute nothing.
    """
    pool = list(cards) if cards is not None else load_cards()
    found = {c.domain for c in pool if isinstance(c, PrincipleCard) and c.domain}
    return sorted(found)


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _walk_and_parse(directory: Path) -> tuple[list[Card], list[LoadFailure]]:
    if not directory.is_dir():
        raise FileNotFoundError(
            f"Cards directory not found: {directory}. "
            "The Python SDK expects cards/ to live at the lemma/ root."
        )
    cards: list[Card] = []
    failures: list[LoadFailure] = []
    for entry in _iter_json_files(directory):
        try:
            payload = _read_json(entry)
            cards.append(parse_card(payload, source_path=entry))
        except (CardValidationError, json.JSONDecodeError, ValueError) as exc:
            failures.append(LoadFailure(path=entry, error=exc))
    return cards, failures


def _iter_json_files(directory: Path) -> Iterator[Path]:
    for entry in sorted(directory.rglob("*.json")):
        # Skip sibling LICENSE / README files that happen to land in JSON
        # subfolders; cards are always plain JSON.
        if entry.name in {"package.json", "package-lock.json"}:
            continue
        yield entry


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


__all__ = [
    "Card",
    "CardsLoadError",
    "LoadFailure",
    "cards_root",
    "load_cards",
    "load_cards_with_failures",
    "iter_cards",
    "find_card",
    "filter_cards",
    "domains",
    "CARDS_DIR",
    "SCHEMA_PATH",
    "PrincipleCard",
    "OpsCard",
    "HypothesisCard",
    "UnidentifiedCard",
]
