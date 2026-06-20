from artano_lemma import find_card, load_cards


def test_load_cards_accepts_metadata():
    cards = load_cards()  # strict models must not reject the metadata field
    assert len(cards) >= 38


def test_card_exposes_tier_and_authors():
    card = find_card("ideal-gas-law")
    assert card is not None
    assert card.metadata is not None
    assert card.metadata.tier == "gold"
    assert card.metadata.authors[0].name == "Arsalan Akhtar"
