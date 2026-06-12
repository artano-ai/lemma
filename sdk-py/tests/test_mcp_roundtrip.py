# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""End-to-end MCP roundtrip: spawn the Python server, connect via the
client, exercise every tool over the stdio wire.

These tests are slow-ish (spawn a subprocess per session) and live
in their own file so they can be skipped quickly with
``pytest --deselect tests/test_mcp_roundtrip.py`` when iterating on
the pure-Python tool implementations.

The harness requires the ``lemma-mcp`` console script to be on
``PATH`` — installing the package in editable mode
(``pip install -e ".[dev]"``) is enough.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sys

import pytest

from artano_lemma.client import LemmaToolError, connect_lemma_stdio


pytestmark = pytest.mark.skipif(
    shutil.which("lemma-mcp") is None,
    reason="lemma-mcp not on PATH (run `pip install -e .` first)",
)


@pytest.fixture(scope="module")
def anyio_backend() -> str:
    return "asyncio"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(coro):
    """Run a coroutine to completion using a fresh event loop.

    pytest-anyio is not in our dev deps, so this thin runner keeps
    the tests dependency-free.
    """
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# Roundtrip tests
# ---------------------------------------------------------------------------


def test_initialize_and_list_tools() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            listing = await client.session.list_tools()
            tool_names = {t.name for t in listing.tools}
            assert tool_names == {
                "cards_list",
                "cards_get",
                "ops_get",
                "hypothesis_crosscheck",
            }

    _run(main())


def test_cards_list_over_the_wire() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            out = await client.cards_list()
            assert "card(s) returned of" in out
            assert "principle" in out

    _run(main())


def test_cards_list_domain_filter_over_the_wire() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            out = await client.cards_list(domain="physics")
            assert "physics" in out.lower()

    _run(main())


def test_cards_get_over_the_wire() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            # First find a real card id from the live corpus
            listing = await client.cards_list()
            # The id format is "- **<id>** v..." in the markdown; grab the first
            first_line = next(
                line for line in listing.splitlines() if line.startswith("- **")
            )
            card_id = first_line.split("**")[1]

            out = await client.cards_get(card_id)
            parsed = json.loads(out)
            assert parsed["id"] == card_id

    _run(main())


def test_cards_get_unknown_id_returns_error() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            with pytest.raises(LemmaToolError) as exc:
                await client.cards_get("definitely-not-a-real-card-id")
            assert "No card with id" in exc.value.message

    _run(main())


def test_hypothesis_crosscheck_inline_over_the_wire() -> None:
    inline = {
        "kind": "hypothesis",
        "id": "wire-test",
        "version": "0.1.0",
        "name": "Wire roundtrip test",
        "proposal": "energy is energy",
        "proposedFormulaTeX": "E = E",
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

    async def main() -> None:
        async with connect_lemma_stdio() as client:
            out = await client.hypothesis_crosscheck(card=inline)
            assert "Cross-check verdict — Wire roundtrip test" in out
            assert "severity NONE" in out

    _run(main())


def test_hypothesis_crosscheck_missing_args_raises_client_side() -> None:
    async def main() -> None:
        async with connect_lemma_stdio() as client:
            with pytest.raises(ValueError):
                await client.hypothesis_crosscheck()

    _run(main())


# Skip on Python 3.10 / Linux if subprocess startup is slow in CI; we keep
# the tests opt-in via the lemma-mcp-on-path skip already.
del sys  # silence unused-import linters
