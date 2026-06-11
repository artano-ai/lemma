#!/usr/bin/env python3
"""
Validate a card payload against the schema — in process.

The same structural check the `ajv-cli` command runs, but in Python: a
well-formed card parses; a malformed one raises a structured error. This is
layer 1 — is the card *shaped* right? — before the cross-check engine ever
looks at the physics.

Run:
    pip install -e ../sdk-py
    python validate_card.py
"""
from artano_lemma import (
    CardValidationError,
    is_valid_card_payload,
    parse_card,
    validate_card_payload,
)

good = {
    "kind": "principle",
    "id": "hookes-law-demo",
    "version": "1.0.0",
    "name": "Hooke's law (demo)",
    "domain": "engineering-solid-mechanics",
    "principles": ["linear elasticity"],
    "formulaTeX": "F = -k x",
    "conventions": ["k > 0 (spring constant)", "x measured from equilibrium"],
    "expectedLimits": ["x = 0 => F = 0"],
    "references": ["Landau & Lifshitz, Theory of Elasticity"],
}

bad = {
    "kind": "principle",
    "id": "Bad_ID",          # violates the id pattern ^[a-z][a-z0-9-]*$
    "version": "1.0",        # not semver
    "name": "Broken card",
    "formula": "F = -k x",   # wrong field name; required fields missing
}

print("good payload — is_valid:", is_valid_card_payload(good))
card = parse_card(good)
print(f"  parsed -> {card.name}: {card.formulaTeX}")

print("\nbad payload  — is_valid:", is_valid_card_payload(bad))
try:
    validate_card_payload(bad)
except CardValidationError as e:
    print(f"  rejected — {len(e.issues)} schema violations, e.g.:")
    for issue in e.issues[:4]:
        print(f"    - {issue.path}  {issue.message}")
    print("  (a structurally-invalid card never reaches the cross-check engine)")
