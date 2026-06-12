#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""
The MCP tools, called as plain Python functions.

cards_list / cards_get / ops_get / hypothesis_crosscheck are exactly what an
MCP client (Claude Code, Cursor, ...) invokes over the protocol. Here we call
them in process — each returns a ready-to-read string.

(The fifth tool, rag_lookup, needs a Postgres + pgvector backend, so it is not
part of this dependency-light example — see mcp-server/README.md.)

Run:
    pip install -e ../sdk-py
    python use_mcp_tools.py
"""
from artano_lemma import (
    cards_get,
    cards_list,
    hypothesis_crosscheck,
    load_cards,
    ops_get,
)

corpus = load_cards()


def show(title: str, text: str, limit: int = 380) -> None:
    print(f"\n=== {title} ===")
    print(text[:limit].rstrip() + (" …" if len(text) > limit else ""))


show("cards_list() — grouped catalogue", cards_list(corpus=corpus))
show("cards_get('arrhenius-rate-law')", cards_get("arrhenius-rate-law", corpus=corpus))
show("ops_get('slurm-marenostrum5-gpp-compute')", ops_get("slurm-marenostrum5-gpp-compute", corpus=corpus))
show(
    "hypothesis_crosscheck(id='free-fall-with-linear-drag')",
    hypothesis_crosscheck(id="free-fall-with-linear-drag", corpus=corpus),
    limit=600,
)
