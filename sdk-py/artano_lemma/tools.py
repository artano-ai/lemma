# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Tool implementations — the same surface the Node MCP server exposes.

Pure-Python functions, no MCP runtime dependency. The MCP server in
:mod:`artano_lemma.server` is a thin adapter that registers these
functions as MCP tools; the SDK consumer can also call them
directly without MCP in the path.

Each function returns a string — typically Markdown — matching the
shape the Node ``@artano-ai/mcp-server`` returns. Returning strings
(rather than structured objects) keeps the MCP wire format
identical across the Node and Python implementations: an agent
that switches its config from one to the other gets the same tool
output.

Tools provided:

* :func:`cards_list` — list curated cards (id + name + domain + version + principles).
* :func:`cards_get` — fetch one card's full JSON record.
* :func:`ops_get` — fetch one OpsCard rendered as Markdown.
* :func:`hypothesis_crosscheck` — run the cross-check engine on a HypothesisCard.

Compared to the Node side, ``rag_lookup`` is omitted here because it
needs a Postgres + pgvector backend (it lives in the Node
mcp-server). The DFT-specific tools (parse_siesta_fdf,
parse_eig_file, generate_slurm) are execution-layer — not part of the
Lemma verification substrate — and live in the Artano clients and the
planned execution substrate.
"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Iterable, Sequence

from .cards import load_cards
from .engine import run_hypothesis_checks
from .types import (
    Card,
    HypothesisCard,
    OpsCard,
    PrincipleCard,
)
from .validator import parse_card


# ---------------------------------------------------------------------------
# Internals — corpus shaping
# ---------------------------------------------------------------------------


def _corpus(corpus: Iterable[Card] | None) -> Sequence[Card]:
    """Default to the bundled corpus when none was provided."""
    return list(corpus) if corpus is not None else load_cards()


def _split(corpus: Sequence[Card]) -> tuple[list[PrincipleCard], list[OpsCard], list[HypothesisCard]]:
    principles: list[PrincipleCard] = []
    ops: list[OpsCard] = []
    hypotheses: list[HypothesisCard] = []
    for c in corpus:
        if isinstance(c, PrincipleCard):
            principles.append(c)
        elif isinstance(c, OpsCard):
            ops.append(c)
        elif isinstance(c, HypothesisCard):
            hypotheses.append(c)
    return principles, ops, hypotheses


def _find_by_id(corpus: Sequence[Card], card_id: str) -> Card | None:
    for c in corpus:
        if c.id == card_id:
            return c
    return None


# ---------------------------------------------------------------------------
# cards_list
# ---------------------------------------------------------------------------


def cards_list(
    domain: str | None = None,
    *,
    corpus: Iterable[Card] | None = None,
) -> str:
    """List the curated cards as Markdown.

    Mirrors the Node ``cards_list`` tool. Returns a grouped-by-domain
    Markdown listing of principle cards (one line per card with id,
    version, name, and principles), an ``ops`` block when ops cards
    are included, and a footer with the total count.

    :param domain: case-insensitive substring filter on
        ``card.domain``. Pass ``"ops"`` to filter to ops cards only.
        Pass ``None`` (default) or an empty string to list every card.
    :param corpus: optional explicit corpus. Defaults to the bundled
        cards/ corpus.
    """
    principles, ops_cards, _hypotheses = _split(_corpus(corpus))

    filter_str = (domain or "").lower().strip()

    principle_matches: list[PrincipleCard]
    if filter_str:
        principle_matches = [
            p for p in principles if (p.domain or "").lower().find(filter_str) >= 0
        ]
    else:
        principle_matches = principles

    if filter_str == "" or "ops".find(filter_str) >= 0 or filter_str == "ops":
        ops_matches: list[OpsCard] = ops_cards
    else:
        ops_matches = []

    if not principle_matches and not ops_matches:
        known = sorted({p.domain or "uncategorised" for p in principles})
        return (
            f'No cards match domain filter "{filter_str}". '
            f"Known principle-card domains: {', '.join(known)}. "
            f'Use domain="ops" to filter to ops cards only.'
        )

    blocks: list[str] = []

    if principle_matches:
        grouped: dict[str, list[PrincipleCard]] = defaultdict(list)
        for c in principle_matches:
            grouped[c.domain or "uncategorised"].append(c)
        for domain_key, bucket in grouped.items():
            blocks.append(
                f"## {domain_key} — {len(bucket)} card{'s' if len(bucket) != 1 else ''}"
            )
            for c in bucket:
                joined_principles = " · ".join(c.principles)
                blocks.append(
                    f"- **{c.id}** v{c.version} — {c.name}\n"
                    f"  principles: {joined_principles}"
                )

    if ops_matches:
        blocks.append(
            f"## ops — {len(ops_matches)} ops card{'s' if len(ops_matches) != 1 else ''}"
        )
        for c in ops_matches:
            desc = c.description
            short = desc[:140] + ("…" if len(desc) > 140 else "")
            blocks.append(f"- **{c.id}** v{c.version} — {c.name}\n  {short}")

    total_returned = len(principle_matches) + len(ops_matches)
    total_corpus = len(principles) + len(ops_cards)
    blocks.append(
        f"\n_{total_returned} card(s) returned of {total_corpus} in corpus "
        f"({len(principles)} principle + {len(ops_cards)} ops)._"
    )
    return "\n".join(blocks)


# ---------------------------------------------------------------------------
# cards_get
# ---------------------------------------------------------------------------


def cards_get(
    card_id: str,
    *,
    corpus: Iterable[Card] | None = None,
) -> str:
    """Fetch a card by id and return its full JSON record as a string.

    Refuses to fabricate — raises :class:`ValueError` for unknown
    ids, listing every valid id in the corpus.

    :param card_id: card id, e.g. ``"michaelis-menten-enzyme-kinetics"``.
    :param corpus: optional explicit corpus.
    """
    card_id = (card_id or "").strip()
    if not card_id:
        raise ValueError("Empty id.")

    full_corpus = _corpus(corpus)
    found = _find_by_id(full_corpus, card_id)
    if found is None:
        principles, ops_cards, _hypotheses = _split(full_corpus)
        known_principles = ", ".join(p.id for p in principles)
        known_ops = ", ".join(o.id for o in ops_cards) or "(none)"
        raise ValueError(
            f'No card with id "{card_id}" in the corpus. '
            f"Known principle-card ids: {known_principles}. "
            f"Known ops-card ids: {known_ops}. "
            f"(Hypothesis cards are listed separately — see hypothesis_crosscheck.)"
        )

    return found.model_dump_json(indent=2, exclude_none=True)


# ---------------------------------------------------------------------------
# ops_get
# ---------------------------------------------------------------------------


def ops_get(
    card_id: str,
    *,
    corpus: Iterable[Card] | None = None,
) -> str:
    """Fetch an OpsCard by id and render it as Markdown.

    Parameters table, validation-rules list, references list.
    """
    card_id = (card_id or "").strip()
    if not card_id:
        raise ValueError("Empty id.")

    full_corpus = _corpus(corpus)
    _principles, ops_cards, _hypotheses = _split(full_corpus)
    ops = next((o for o in ops_cards if o.id == card_id), None)
    if ops is None:
        known_ops = ", ".join(o.id for o in ops_cards) or "(none)"
        raise ValueError(f'No ops card with id "{card_id}". Known ops-card ids: {known_ops}.')

    lines: list[str] = []
    lines.append(f"# {ops.name}  `{ops.id}` v{ops.version}")
    lines.append("")
    lines.append(ops.description)
    lines.append("")

    if ops.parameters:
        lines.append("## Parameters")
        lines.append("")
        lines.append("| Key | Label | Default | Required | Note |")
        lines.append("| --- | --- | --- | --- | --- |")
        for p in ops.parameters:
            default = "_(none)_" if p.defaultValue == "" else f"`{p.defaultValue}`"
            required = "yes" if p.required else "no"
            note = (p.note or "").replace("|", "\\|")
            lines.append(f"| `{p.key}` | {p.label} | {default} | {required} | {note} |")
        lines.append("")

    if ops.validation:
        lines.append("## Validation rules")
        lines.append("")
        for v in ops.validation:
            lines.append(f"- {v}")
        lines.append("")

    if ops.references:
        lines.append("## References")
        lines.append("")
        for r in ops.references:
            lines.append(f"- {r}")
        lines.append("")

    return "\n".join(lines).rstrip()


# ---------------------------------------------------------------------------
# hypothesis_crosscheck
# ---------------------------------------------------------------------------


def hypothesis_crosscheck(
    *,
    id: str | None = None,
    card: dict[str, Any] | HypothesisCard | None = None,
    corpus: Iterable[Card] | None = None,
) -> str:
    """Run the cross-check engine on a HypothesisCard.

    Provide either:

    * ``id`` — the id of an existing HypothesisCard in the corpus, or
    * ``card`` — an inline HypothesisCard (raw dict from the wire or
      an already-parsed :class:`HypothesisCard`).

    Returns the verdict as Markdown matching the Node tool's output —
    per-check bullets with pass/warn/fail glyphs, the diagnosis, and
    the raw JSON in a fenced block at the end.
    """
    full_corpus = _corpus(corpus)

    hypothesis: HypothesisCard
    if id:
        _principles, _ops, hypotheses = _split(full_corpus)
        match = next((h for h in hypotheses if h.id == id), None)
        if match is None:
            known = ", ".join(h.id for h in hypotheses) or "(none)"
            raise ValueError(f'No hypothesis card with id "{id}". Known: {known}.')
        hypothesis = match
    elif card is not None:
        if isinstance(card, HypothesisCard):
            hypothesis = card
        else:
            if not isinstance(card, dict):
                raise ValueError(
                    "card must be a dict (inline JSON record) or a "
                    "HypothesisCard instance."
                )
            if card.get("kind") != "hypothesis":
                raise ValueError(
                    f'Inline card.kind must be "hypothesis" '
                    f'(got "{card.get("kind") or "undefined"}").'
                )
            parsed = parse_card(card)
            if not isinstance(parsed, HypothesisCard):
                raise ValueError(
                    "Inline card parsed but did not yield a HypothesisCard."
                )
            hypothesis = parsed
    else:
        raise ValueError(
            "Provide either `id` (existing card) or `card` "
            "(inline HypothesisCard JSON)."
        )

    verdict = run_hypothesis_checks(hypothesis, corpus=full_corpus)

    lines: list[str] = []
    lines.append(f"# Cross-check verdict — {hypothesis.name}")
    lines.append(
        f"Card: `{hypothesis.id}` v{hypothesis.version} · origin: {hypothesis.origin}"
    )
    if hypothesis.derivedFrom is not None:
        lines.append(
            f"Derived: {hypothesis.derivedFrom.relationship} "
            f"`{hypothesis.derivedFrom.cardId}`"
        )
    lines.append(
        f"\n**Overall:** {verdict.overall.passing} / {verdict.overall.total} pass "
        f"· severity {verdict.overall.severity}"
    )
    lines.append("")
    for chk in verdict.checks:
        mark = "✓" if chk.severity == "pass" else ("!" if chk.severity == "warn" else "✗")
        lines.append(f"- [{mark}] **{chk.name}** — {chk.detail}")
    lines.append("")
    lines.append(f"**Diagnosis:** {verdict.diagnosis}")
    lines.append("")
    lines.append("---")
    lines.append("Raw JSON:")
    lines.append("```json")
    lines.append(json.dumps(verdict.model_dump(), indent=2))
    lines.append("```")

    return "\n".join(lines)


__all__ = [
    "cards_list",
    "cards_get",
    "ops_get",
    "hypothesis_crosscheck",
]
