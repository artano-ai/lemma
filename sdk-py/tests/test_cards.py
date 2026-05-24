"""Sanity tests for the cards loader."""

from __future__ import annotations

import pytest

from artano_lemma.cards import CARDS_DIR, load_cards


pytestmark = pytest.mark.skipif(
    not CARDS_DIR.is_dir(),
    reason="cards/ folder not present (expected at lemma/cards/)",
)


def test_loads_cards() -> None:
    cards = load_cards()
    assert len(cards) > 0
    ids = {c.id for c in cards}
    assert len(ids) == len(cards), "card ids must be unique"


def test_every_card_has_required_fields() -> None:
    for card in load_cards():
        assert card.id
        assert card.kind
        assert card.title
