"""Loader for the Lemma cards corpus.

Resolves the cards directory bundled at ``lemma/cards/`` relative to
this SDK and offers a typed accessor over the JSON files. The format
mirrors the JSON Schema at ``lemma/schema/card.v0.1.json``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


PACKAGE_DIR = Path(__file__).resolve().parent
# sdk-py/artano_lemma/ → sdk-py/ → lemma/
LEMMA_ROOT = PACKAGE_DIR.parent.parent
CARDS_DIR = LEMMA_ROOT / "cards"
SCHEMA_PATH = LEMMA_ROOT / "schema" / "card.v0.1.json"


def cards_root() -> Path:
    return CARDS_DIR


@dataclass(frozen=True)
class Card:
    id: str
    kind: str
    domain: str
    title: str
    raw: dict[str, Any]

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "Card":
        return cls(
            id=payload["id"],
            kind=payload.get("kind", "principle"),
            domain=payload.get("domain", "unknown"),
            title=payload.get("title", payload["id"]),
            raw=payload,
        )


def load_cards(directory: Path | None = None) -> list[Card]:
    target = directory or CARDS_DIR
    if not target.is_dir():
        raise FileNotFoundError(
            f"Cards directory not found: {target}. "
            "The Python SDK expects cards/ to live at the lemma/ root."
        )
    cards: list[Card] = []
    for entry in sorted(target.rglob("*.json")):
        payload = json.loads(entry.read_text(encoding="utf-8"))
        cards.append(Card.from_json(payload))
    return cards


def iter_cards(directory: Path | None = None) -> Iterable[Card]:
    yield from load_cards(directory)
