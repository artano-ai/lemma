# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Python MCP server for Lemma.

Thin adapter that exposes :mod:`artano_lemma.tools` as MCP tools
over the stdio transport, using the official ``mcp`` Python SDK.
This is a drop-in alternative to the Node ``@artano-ai/mcp-server``:
agent configurations can swap between them by changing ``command``
in the runtime's MCP config.

Run as a console script (configured in ``pyproject.toml``)::

    lemma-mcp

Or as a Typer subcommand on the main ``lemma`` CLI::

    lemma serve

Agent runtime config (Claude Code, Cursor, Codex, …)::

    {
      "mcpServers": {
        "lemma": {
          "command": "lemma-mcp"
        }
      }
    }

Tools exposed: ``cards_list``, ``cards_get``, ``ops_get``,
``hypothesis_crosscheck``. ``rag_lookup`` (also provided by the Node
mcp-server) needs a Postgres + pgvector backend, so it is omitted
from this lightweight in-process server.
"""

from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from . import tools as _tools
from .version import __version__


mcp = FastMCP(
    "artano-lemma",
    instructions=(
        f"Lemma — open verification substrate for AI-generated scientific code. "
        f"Python distribution v{__version__}. Tools: cards_list, cards_get, "
        f"ops_get, hypothesis_crosscheck. Call cards_list first to discover "
        f"available cards by id and domain."
    ),
)


# ---------------------------------------------------------------------------
# cards_list
# ---------------------------------------------------------------------------


@mcp.tool(
    name="cards_list",
    description=(
        "List Lemma cards in the local corpus. Returns id, name, domain, "
        "version, and a one-line summary for each card. Includes both "
        "principle cards (physics, chemistry, biology, …) and ops cards "
        "(SLURM templates, workflow recipes). Optionally filter by `domain` "
        'substring (e.g. "physics", "chemistry-thermo", "ops"). Use '
        "cards_get to retrieve the full record for a specific id."
    ),
)
def cards_list_tool(domain: str = "") -> str:
    """Filter argument is a case-insensitive substring on card.domain (or "ops")."""
    return _tools.cards_list(domain or None)


# ---------------------------------------------------------------------------
# cards_get
# ---------------------------------------------------------------------------


@mcp.tool(
    name="cards_get",
    description=(
        "Fetch a full Lemma card by id. Returns the JSON record "
        "(PrincipleCard, OpsCard, or HypothesisCard). Use cards_list first "
        "to discover available ids. Returns an error if the id is unknown "
        "— Lemma refuses to fabricate cards on demand."
    ),
)
def cards_get_tool(id: str) -> str:  # noqa: A002 — name matches the tool param
    """id is the card id, e.g. "free-fall-uniform-gravity"."""
    return _tools.cards_get(id)


# ---------------------------------------------------------------------------
# ops_get
# ---------------------------------------------------------------------------


@mcp.tool(
    name="ops_get",
    description=(
        "Fetch a full Lemma ops card by id and render it as human-readable "
        "Markdown (parameters table, validation rules, references). Ops "
        "cards are parameterised templates for scripting / job-submission "
        'tasks (SLURM, Snakemake, Singularity). Use cards_list with '
        'domain="ops" to discover available ids. Use cards_get for the raw '
        "JSON record."
    ),
)
def ops_get_tool(id: str) -> str:  # noqa: A002
    """id is the ops-card id, e.g. "slurm-mn5-gpu"."""
    return _tools.ops_get(id)


# ---------------------------------------------------------------------------
# hypothesis_crosscheck
# ---------------------------------------------------------------------------


@mcp.tool(
    name="hypothesis_crosscheck",
    description=(
        "Run the Lemma hypothesis cross-check engine on a HypothesisCard. "
        "Pass either an `id` (a hypothesis already in the corpus) OR a "
        "`card` object (an inline HypothesisCard JSON, e.g. one freshly "
        "proposed by an LLM). Returns the verdict: dimensional analysis "
        "(real), reference-corpus resolution (real), declared limit / "
        "conservation claims (warn pending symbolic verification), and a "
        "diagnosis."
    ),
)
def hypothesis_crosscheck_tool(
    id: str | None = None,  # noqa: A002
    card: dict[str, Any] | None = None,
) -> str:
    """Either `id` (existing card) or `card` (inline JSON) must be set."""
    return _tools.hypothesis_crosscheck(id=id, card=card)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    """Run the MCP server over stdio.

    Invoked by the ``lemma-mcp`` console script (see pyproject.toml)
    and by ``lemma serve`` on the main CLI.
    """
    mcp.run()


if __name__ == "__main__":
    main()
