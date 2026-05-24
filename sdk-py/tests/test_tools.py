"""Unit tests for the pure-Python tool implementations.

These exercise the same functions the MCP server registers, but
without spinning up the MCP wire — so they're fast and don't need
a subprocess. The MCP roundtrip itself is covered in
tests/test_mcp_roundtrip.py.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from artano_lemma import (
    Card,
    cards_get,
    cards_list,
    hypothesis_crosscheck,
    ops_get,
    parse_card,
)
from artano_lemma.cards import CARDS_DIR
from artano_lemma.types import HypothesisCard, OpsCard, PrincipleCard


pytestmark = pytest.mark.skipif(
    not CARDS_DIR.is_dir(),
    reason="cards/ folder not present",
)


# ---------------------------------------------------------------------------
# Fixtures — small synthetic corpus
# ---------------------------------------------------------------------------


def _principle(card_id: str, *, domain: str = "physics-test") -> PrincipleCard:
    p = parse_card(
        {
            "kind": "principle",
            "id": card_id,
            "version": "1.0.0",
            "name": card_id.replace("-", " ").title(),
            "domain": domain,
            "principles": ["a", "b"],
            "formulaTeX": "y = x",
            "conventions": [],
            "expectedLimits": [],
            "references": [],
        }
    )
    assert isinstance(p, PrincipleCard)
    return p


def _ops(card_id: str) -> OpsCard:
    o = parse_card(
        {
            "kind": "ops",
            "id": card_id,
            "version": "1.0.0",
            "name": "Test ops",
            "description": "A test ops card.",
            "parameters": [
                {"key": "nodes", "label": "Nodes", "defaultValue": "1", "required": True},
            ],
            "validation": ["nodes > 0"],
            "references": [],
        }
    )
    assert isinstance(o, OpsCard)
    return o


def _hypothesis(card_id: str = "test-hyp", **overrides: Any) -> HypothesisCard:
    payload: dict[str, Any] = {
        "kind": "hypothesis",
        "id": card_id,
        "version": "0.1.0",
        "name": "Test hypothesis",
        "proposal": "...",
        "proposedFormulaTeX": "y = x",
        "checks": {},
        "references": [],
        "origin": "human",
    }
    payload.update(overrides)
    h = parse_card(payload)
    assert isinstance(h, HypothesisCard)
    return h


@pytest.fixture
def corpus() -> list[Card]:
    return [
        _principle("free-fall-uniform-gravity", domain="physics-classical-mechanics"),
        _principle("ideal-gas-law", domain="chemistry-thermodynamics"),
        _principle("michaelis-menten", domain="biology-enzyme-kinetics"),
        _ops("slurm-mn5-gpu"),
    ]


# ---------------------------------------------------------------------------
# cards_list
# ---------------------------------------------------------------------------


def test_cards_list_returns_every_card_unfiltered(corpus: list[Card]) -> None:
    out = cards_list(corpus=corpus)
    assert "free-fall-uniform-gravity" in out
    assert "ideal-gas-law" in out
    assert "michaelis-menten" in out
    assert "slurm-mn5-gpu" in out
    assert "4 card(s) returned of 4 in corpus" in out


def test_cards_list_filters_by_domain_substring(corpus: list[Card]) -> None:
    out = cards_list(domain="physics", corpus=corpus)
    assert "free-fall-uniform-gravity" in out
    assert "ideal-gas-law" not in out
    assert "michaelis-menten" not in out


def test_cards_list_filter_is_case_insensitive(corpus: list[Card]) -> None:
    out = cards_list(domain="PHYSICS", corpus=corpus)
    assert "free-fall-uniform-gravity" in out


def test_cards_list_ops_filter(corpus: list[Card]) -> None:
    out = cards_list(domain="ops", corpus=corpus)
    assert "slurm-mn5-gpu" in out
    assert "free-fall-uniform-gravity" not in out


def test_cards_list_unknown_filter_lists_known_domains(corpus: list[Card]) -> None:
    out = cards_list(domain="zzz-not-a-domain", corpus=corpus)
    assert "No cards match domain filter" in out
    assert "physics-classical-mechanics" in out


# ---------------------------------------------------------------------------
# cards_get
# ---------------------------------------------------------------------------


def test_cards_get_returns_json(corpus: list[Card]) -> None:
    out = cards_get("ideal-gas-law", corpus=corpus)
    parsed = json.loads(out)
    assert parsed["id"] == "ideal-gas-law"
    assert parsed["kind"] == "principle"


def test_cards_get_unknown_id_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError) as exc:
        cards_get("nope", corpus=corpus)
    assert "No card with id" in str(exc.value)
    # The error lists the known principle ids
    assert "free-fall-uniform-gravity" in str(exc.value)


def test_cards_get_empty_id_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError, match="Empty id"):
        cards_get("", corpus=corpus)


# ---------------------------------------------------------------------------
# ops_get
# ---------------------------------------------------------------------------


def test_ops_get_returns_markdown(corpus: list[Card]) -> None:
    out = ops_get("slurm-mn5-gpu", corpus=corpus)
    assert "# Test ops" in out
    assert "## Parameters" in out
    assert "| `nodes` | Nodes |" in out
    assert "## Validation rules" in out
    assert "- nodes > 0" in out


def test_ops_get_unknown_id_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError, match="No ops card with id"):
        ops_get("not-an-ops-card", corpus=corpus)


def test_ops_get_rejects_principle_id(corpus: list[Card]) -> None:
    """A principle-card id should not resolve through ops_get."""
    with pytest.raises(ValueError):
        ops_get("free-fall-uniform-gravity", corpus=corpus)


# ---------------------------------------------------------------------------
# hypothesis_crosscheck
# ---------------------------------------------------------------------------


def test_hypothesis_crosscheck_inline_card(corpus: list[Card]) -> None:
    inline = {
        "kind": "hypothesis",
        "id": "h1",
        "version": "0.1.0",
        "name": "Inline test",
        "proposal": "...",
        "proposedFormulaTeX": "y = x",
        "checks": {
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "energy",
                "rhsDims": {"M": 1, "L": 2, "T": -2},
            },
        },
        "references": [],
        "origin": "llm",
    }
    out = hypothesis_crosscheck(card=inline, corpus=corpus)
    assert "Cross-check verdict — Inline test" in out
    assert "severity NONE" in out
    assert "All declared cross-checks pass" in out


def test_hypothesis_crosscheck_inline_dimensional_mismatch(corpus: list[Card]) -> None:
    inline = {
        "kind": "hypothesis",
        "id": "h2",
        "version": "0.1.0",
        "name": "Mismatch test",
        "proposal": "...",
        "proposedFormulaTeX": "y = x",
        "checks": {
            "dimensional": {
                "lhsLabel": "energy",
                "lhsDims": {"M": 1, "L": 2, "T": -2},
                "rhsLabel": "force",
                "rhsDims": {"M": 1, "L": 1, "T": -2},
            },
        },
        "references": [],
        "origin": "llm",
    }
    out = hypothesis_crosscheck(card=inline, corpus=corpus)
    assert "severity HIGH" in out
    assert "fails one or more hard cross-checks" in out


def test_hypothesis_crosscheck_inline_wrong_kind_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError, match='kind must be "hypothesis"'):
        hypothesis_crosscheck(card={"kind": "principle", "id": "x"}, corpus=corpus)


def test_hypothesis_crosscheck_no_id_no_card_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError, match="Provide either"):
        hypothesis_crosscheck(corpus=corpus)


def test_hypothesis_crosscheck_existing_id(corpus: list[Card]) -> None:
    """A HypothesisCard already in the corpus is looked up by id."""
    h = _hypothesis(
        "h-existing",
        derivedFrom={"cardId": "ideal-gas-law", "relationship": "extends"},
    )
    corpus_with_h: list[Card] = list(corpus) + [h]
    out = hypothesis_crosscheck(id="h-existing", corpus=corpus_with_h)
    assert "Cross-check verdict — Test hypothesis" in out
    # derivedFrom resolves
    assert "ideal-gas-law" in out
    assert "link resolves" in out


def test_hypothesis_crosscheck_unknown_id_raises(corpus: list[Card]) -> None:
    with pytest.raises(ValueError, match="No hypothesis card with id"):
        hypothesis_crosscheck(id="not-there", corpus=corpus)
