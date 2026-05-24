"""Sanity tests for the cards loader + the typed parser + the validator."""

from __future__ import annotations

import pytest

from artano_lemma import (
    CardValidationError,
    PrincipleCard,
    OpsCard,
    HypothesisCard,
    UnidentifiedCard,
    domains,
    filter_cards,
    find_card,
    is_valid_card_payload,
    load_cards,
    parse_card,
    validate_card_payload,
)
from artano_lemma.cards import CARDS_DIR


pytestmark = pytest.mark.skipif(
    not CARDS_DIR.is_dir(),
    reason="cards/ folder not present (expected at lemma/cards/)",
)


# ---------------------------------------------------------------------------
# Loader basics
# ---------------------------------------------------------------------------


def test_load_cards_returns_typed_objects() -> None:
    cards = load_cards()
    assert len(cards) > 0, "expected the bundled corpus to be non-empty"

    # Every card is exactly one of the four discriminated variants
    for c in cards:
        assert isinstance(c, (PrincipleCard, OpsCard, HypothesisCard, UnidentifiedCard))


def test_card_ids_unique() -> None:
    cards = load_cards()
    ids = [c.id for c in cards]
    assert len(set(ids)) == len(ids), "card ids must be unique across the corpus"


def test_every_card_has_required_fields() -> None:
    for c in load_cards():
        assert c.id
        assert c.kind
        assert c.name
        assert c.version


# ---------------------------------------------------------------------------
# Filtering / lookup
# ---------------------------------------------------------------------------


def test_find_card_by_id() -> None:
    cards = load_cards()
    first = cards[0]
    found = find_card(first.id)
    assert found is not None
    assert found.id == first.id


def test_find_card_missing_returns_none() -> None:
    assert find_card("definitely-not-a-real-card-id-12345") is None


def test_filter_by_kind() -> None:
    principles = filter_cards(kind="principle")
    assert all(c.kind == "principle" for c in principles)
    assert all(isinstance(c, PrincipleCard) for c in principles)


def test_filter_by_domain_prefix() -> None:
    physics = filter_cards(domain_prefix="physics-")
    for c in physics:
        assert isinstance(c, PrincipleCard)
        assert c.domain is not None
        assert c.domain.startswith("physics-")


def test_domains_returns_sorted_unique_list() -> None:
    found = domains()
    assert found == sorted(set(found)), "domains() must return a sorted unique list"


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------


_MINIMAL_PRINCIPLE = {
    "kind": "principle",
    "id": "test-card",
    "version": "1.0.0",
    "name": "Test card",
    "principles": ["test principle"],
    "formulaTeX": "y = x",
    "conventions": [],
    "expectedLimits": [],
    "references": [],
}


def test_minimal_principle_validates() -> None:
    validate_card_payload(_MINIMAL_PRINCIPLE)
    assert is_valid_card_payload(_MINIMAL_PRINCIPLE)


def test_missing_required_field_fails_validation() -> None:
    bad = {k: v for k, v in _MINIMAL_PRINCIPLE.items() if k != "principles"}
    with pytest.raises(CardValidationError) as exc:
        validate_card_payload(bad)
    assert any("principles" in i.message for i in exc.value.issues)


def test_wrong_kind_fails_validation() -> None:
    bad = {**_MINIMAL_PRINCIPLE, "kind": "not-a-real-kind"}
    assert not is_valid_card_payload(bad)


def test_extra_field_fails_validation() -> None:
    bad = {**_MINIMAL_PRINCIPLE, "made_up_field": 42}
    with pytest.raises(CardValidationError):
        validate_card_payload(bad)


def test_invalid_id_pattern_fails_validation() -> None:
    bad = {**_MINIMAL_PRINCIPLE, "id": "Has-Caps-And-Spaces "}
    with pytest.raises(CardValidationError):
        validate_card_payload(bad)


def test_parse_card_returns_typed_model() -> None:
    card = parse_card(_MINIMAL_PRINCIPLE)
    assert isinstance(card, PrincipleCard)
    assert card.id == "test-card"
    assert card.name == "Test card"
