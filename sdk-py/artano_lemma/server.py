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
``hypothesis_crosscheck``, ``usce_check``, ``series_check``,
``convergence_check``, ``agreement_check`` — eight of the Node
server's nine, rendering **byte-identical** verdicts, because the two
are drop-in alternatives: a runtime swaps between them by changing one
``command``, and a verdict that read differently depending on which was
installed would make that choice visible when it should be invisible.

``rag_lookup`` is the one omission, and it is deliberate: it needs a
Postgres + pgvector backend and an embedding model, which this
lightweight in-process server does not assume.
"""

from __future__ import annotations

import json
from typing import Any

# The server class was renamed in mcp 2.0: `mcp.server.fastmcp.FastMCP` became
# `mcp.server.MCPServer`, and the `fastmcp` subpackage became `mcpserver`. The
# constructor kwargs, the `.tool()` decorator and `.run()` are unchanged, so
# supporting both is an import shim rather than a port.
#
# Doing it this way instead of pinning `mcp<2` matters: pinning below the
# current major would keep anyone on a modern mcp from installing this package
# at all, to spare a rename.
try:  # mcp >= 2.0
    from mcp.server import MCPServer as _McpServer
except ImportError:  # pragma: no cover - mcp 1.x
    from mcp.server.fastmcp import FastMCP as _McpServer

from . import tools as _tools
from .version import __version__


mcp = _McpServer(
    "artano-lemma",
    instructions=(
        f"Lemma — open verification substrate for AI-generated scientific code. "
        f"Python distribution v{__version__}. Tools: cards_list, cards_get, "
        f"ops_get, hypothesis_crosscheck, usce_check, series_check, "
        f"convergence_check, agreement_check. Call cards_list first to discover "
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
# Finished-run checkers
#
# Four shapes of evidence about one run. `usce_check` bounds a single value;
# `series_check` bounds every sample of a reported series and reaches cards that
# deliberately carry no envelopes; `convergence_check` measures a rate from a
# refinement study instead of trusting a reported one; `agreement_check`
# compares independent methods rather than one result against a bound.
# ---------------------------------------------------------------------------


@mcp.tool(
    name="usce_check",
    description=(
        "Run the Universal Sanity Check Engine on a finished numeric output: "
        "range-check the values against a principle card's validationEnvelopes. "
        "Pass `id` (a principle card id) and `output` (a map of envelope key to "
        "number). Returns per-key verdicts and an overall severity."
    ),
)
def usce_check_tool(id: str, output: dict[str, float]) -> str:  # noqa: A002
    """Range-check a finished output against a card's envelopes."""
    return _tools.usce_check(id=id, output=output)


@mcp.tool(
    name="series_check",
    description=(
        "Check a reported series against the sign and bound conditions a "
        "principle card declares in `seriesConditions`. Pass `id` and `series` "
        "(a map of quantity name to its samples — columns of one table, all the "
        "same length). Distinct from usce_check, which bounds a magnitude: these "
        "bound a SIGN or relation, which can be universal where a magnitude is "
        "not. That is why cards deliberately carrying no validationEnvelopes can "
        "still be checked here — a density of states has no system-independent "
        "range but cannot be negative in any material."
    ),
)
def series_check_tool(id: str, series: dict[str, list[float]]) -> str:  # noqa: A002
    """Check a reported series against the card's declared conditions."""
    return _tools.series_check(id=id, series=series)


@mcp.tool(
    name="convergence_check",
    description=(
        "Recompute an observed order of accuracy from a refinement study and "
        "check it against the order a principle card declares. Pass `id` and "
        "`refinement` (an array of [h, error] pairs). Differs from reporting the "
        "order to usce_check: that range-checks a number you supply, this "
        "measures the order from the study itself. A sequence that is not a clean "
        "power law returns a warning with the per-level orders attached rather "
        "than a failure, because a contaminated measurement is not a wrong method."
    ),
)
def convergence_check_tool(id: str, refinement: list[list[float]]) -> str:  # noqa: A002
    """Measure the convergence order from a refinement study."""
    return _tools.convergence_check(id=id, refinement=refinement)


@mcp.tool(
    name="agreement_check",
    description=(
        "Check whether independent methods agree on the same observables, within "
        "the tolerances a principle card declares in `crossMethodTolerances`. "
        "Pass `id` and `outputs` (a map of method name to that method's "
        "observables). One relation above usce_check: an envelope bounds a single "
        "run's value, this bounds the DISAGREEMENT between runs. Fewer than two "
        "methods is an error — a single method cannot corroborate itself."
    ),
)
def agreement_check_tool(id: str, outputs: dict[str, dict[str, float]]) -> str:  # noqa: A002
    """Check cross-method agreement against the card's tolerances."""
    return _tools.agreement_check(id=id, outputs=outputs)


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
