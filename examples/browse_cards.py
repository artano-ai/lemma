#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""
Browse the Lemma cards corpus — the corpus-access layer.

Load, count, filter, and read cards. No database, no API keys.

Run:
    pip install -e ../sdk-py
    python browse_cards.py
"""
from collections import Counter

from artano_lemma import domains, filter_cards, find_card, load_cards

cards = load_cards()
print(f"{len(cards)} cards across {len(domains(cards))} domains.")
print("by kind:", dict(Counter(c.kind for c in cards)))

# Filter to one subject area.
chem = filter_cards(domain_prefix="chemistry", cards=cards)
print(f"\nchemistry cards ({len(chem)}):")
for c in chem:
    print(f"  {c.id:34} {c.domain}")

# Read one card in full.
card = find_card("arrhenius-rate-law", cards)
if card is not None:
    print(f"\n{card.name}  [{card.domain}]  v{card.version}")
    print(f"  formulaTeX:  {card.formulaTeX}")
    print("  conventions:")
    for conv in card.conventions:
        print(f"    - {conv}")
    print("  expected limits:")
    for lim in card.expectedLimits:
        print(f"    - {lim}")
