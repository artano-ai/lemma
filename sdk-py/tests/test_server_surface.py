# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""The Python MCP server's registered tool set.

Two things this file exists to prevent, both of which had already happened:

1. **The two servers drifting apart.** The Node server exposed nine tools while
   this one exposed four, despite both being documented as "the Lemma MCP
   server" — so a client connecting to ``lemma serve`` got a different surface
   from one connecting to ``lemma-mcp-server``. Nothing detected it because
   each was tested against its own output.

2. **``server.py`` rotting unimported.** No test loaded the module, so nobody
   noticed that ``mcp`` 2.x removed ``mcp.server.fastmcp`` — the import the
   server is built on — while ``pyproject.toml`` still admitted ``mcp>=1.0``.
   An install could therefore produce a ``lemma serve`` that cannot start, with
   no signal until someone ran it.

The registration assertions read ``server.py`` as **source text** rather than
importing it. That is deliberate: importing needs a compatible ``mcp``, and a
guard that only runs when the dependency is right is no guard at the version
boundary where it matters most.
"""

from __future__ import annotations

import pathlib
import re

import pytest

from artano_lemma import tools

SERVER = pathlib.Path(__file__).resolve().parents[1] / "artano_lemma" / "server.py"
SOURCE = SERVER.read_text(encoding="utf-8")

#: Every tool this server is meant to register. `rag_lookup` is the one
#: deliberate omission from the Node set — it needs Postgres + pgvector and an
#: embedding model, which this in-process server does not assume.
EXPECTED = {
    "cards_list",
    "cards_get",
    "ops_get",
    "hypothesis_crosscheck",
    "usce_check",
    "series_check",
    "convergence_check",
    "agreement_check",
}

NODE_ONLY = {"rag_lookup"}


def registered() -> set[str]:
    return set(re.findall(r'@mcp\.tool\(\s*name="([a-z_]+)"', SOURCE))


def test_the_registered_set_is_exactly_what_is_documented():
    assert registered() == EXPECTED


def test_rag_lookup_is_absent_and_the_module_says_why():
    assert not (registered() & NODE_ONLY)
    assert "Postgres" in SOURCE and "rag_lookup" in SOURCE, (
        "the omission must be explained in the module, or it reads as an oversight"
    )


def test_every_registered_tool_has_a_backing_function():
    for name in registered():
        assert hasattr(tools, name), f"server registers {name} with no tools.{name}"


def test_the_instructions_string_lists_the_same_tools():
    """The instructions are what a model reads to decide what it can call. A
    tool registered but unlisted there is effectively invisible."""
    # The instructions are built from concatenated f-string fragments, so the
    # sentence is split across source lines. Join them before matching.
    joined = re.sub(r'"\s*\n\s*f?"', "", SOURCE)
    match = re.search(r"Tools: ([a-z_, ]+)\.", joined)
    assert match, "the FastMCP instructions should enumerate the tools"
    listed = {t.strip() for t in match.group(1).split(",") if t.strip()}
    assert listed == EXPECTED


@pytest.mark.parametrize("name", sorted(EXPECTED - {"cards_list", "cards_get", "ops_get", "hypothesis_crosscheck"}))
def test_the_new_checkers_render_a_verdict(name):
    """The four added after the Node server reached nine. Rendering is asserted
    byte-for-byte against the Node output by the cross-language comparison; here
    we only confirm each is callable and produces a verdict."""
    fn = getattr(tools, name)
    args = {
        "usce_check": {"id": "free-fall-uniform-gravity", "output": {"gEarth_m_per_s2": 9.81}},
        "series_check": {"id": "density-of-states", "series": {"epsilon": [-1, 0, 1], "g": [0.0, 1.2, 0.4]}},
        "convergence_check": {"id": "runge-kutta-4", "refinement": [[0.1, 1e-7], [0.05, 6.25e-9]]},
        "agreement_check": {
            "id": "cross-method-reproducibility",
            "outputs": {"a": {"latticeConstant_A": 5.470}, "b": {"latticeConstant_A": 5.475}},
        },
    }[name]
    out = fn(**args)
    assert out.startswith("# ")
    assert "**Overall:**" in out


def test_an_unknown_card_is_refused_rather_than_invented():
    for name, extra in [
        ("usce_check", {"output": {}}),
        ("series_check", {"series": {}}),
        ("convergence_check", {"refinement": []}),
        ("agreement_check", {"outputs": {}}),
    ]:
        with pytest.raises(ValueError, match="No principle card with id"):
            getattr(tools, name)(id="no-such-card", **extra)


def test_the_server_imports_work_on_both_mcp_majors():
    """`mcp` 2.0 renamed the server class: `mcp.server.fastmcp.FastMCP` became
    `mcp.server.MCPServer`. The module must accept both.

    The first fix here was to pin `mcp<2`, which was wrong — it would have kept
    anyone on the current major from installing the package at all, to spare a
    rename. The shim costs four lines and keeps the dependency range open.
    """
    assert "from mcp.server import MCPServer" in SOURCE, "mcp 2.x import missing"
    assert "from mcp.server.fastmcp import FastMCP" in SOURCE, "mcp 1.x fallback missing"

    pyproject = (SERVER.parents[1] / "pyproject.toml").read_text(encoding="utf-8")
    assert '"mcp>=1.0,<2"' not in pyproject, (
        "the upper bound is unnecessary now that the shim handles both majors"
    )


def test_the_server_actually_starts_and_registers_its_tools():
    """Imports the module for real, against whichever mcp is installed.

    This is the check whose absence let the 2.x incompatibility rot unnoticed:
    nothing loaded `server.py`, because it is only imported lazily inside
    `lemma serve`.
    """
    import asyncio

    from artano_lemma.server import mcp as server

    registered_names = {t.name for t in asyncio.run(server.list_tools())}
    assert registered_names == EXPECTED
