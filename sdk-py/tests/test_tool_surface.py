# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Tool-surface contract: the Python half.

``parity/cases.json`` pins the *engine* against golden text, which works
because its fixture cards are synthetic. The tool surface renders the **live
corpus**, so golden text there would break on every card edit and train whoever
hits it to regenerate reflexively — the exact habit ``parity/README.md`` warns
against. So this file pins *invariants* instead, and its TypeScript twin
(``mcp-server/test/tool-surface.test.ts``) asserts the same ones. A drift in
either language fails that language's own CI job.

Both invariants are regressions that actually shipped:

* **Metadata leak.** ``cards_get`` was documented — in two planning docs — as
  stripping ``metadata`` "verified across all MCP tools". It did in TypeScript
  and did not here, so ``artano-lemma`` sent author names and ORCIDs to the
  model provider on every call. Fixed 17 Aug 2026.
* **Escaped JSON.** ``hypothesis_crosscheck`` embeds the raw verdict as JSON.
  ``json.dumps`` escapes non-ASCII by default, so the block rendered
  ``L\\u00b7T^-2\\u00b7M`` here against ``L·T^-2·M`` in Node. Fixed the same day.

Neither was caught by any test, because each language only ever checked itself.
"""

from __future__ import annotations

import pytest

from artano_lemma import cards_get, cards_list, hypothesis_crosscheck, ops_get

SAMPLES = {
    "cards_list": lambda: cards_list(),
    "cards_get": lambda: cards_get("ideal-gas-law"),
    "ops_get": lambda: ops_get("slurm-marenostrum5-gpp-compute"),
    "hypothesis_crosscheck": lambda: hypothesis_crosscheck(id="free-fall-with-linear-drag"),
}


# --- authorship never reaches the model -------------------------------------
# `metadata` carries author names and ORCIDs. The tool surface is the LLM-facing
# path, so it must be stripped: sending it would leak contributor data to a model
# provider on every call, spend context on non-physics, and invite a model to
# weight a claim by the prestige of whoever curated it.


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_tool_does_not_leak_card_metadata(name: str) -> None:
    out = SAMPLES[name]()
    assert '"metadata"' not in out, f"{name} leaked the metadata block into LLM-facing output."
    assert "orcid" not in out, f"{name} leaked an ORCID into LLM-facing output."


# --- the embedded JSON stays human-readable ---------------------------------
# hypothesis_crosscheck embeds the raw verdict as JSON. It must render literal
# UTF-8, not escapes: a reader of the block should see the dimension symbols,
# not their code points.


def test_hypothesis_crosscheck_embeds_literal_utf8_not_escapes() -> None:
    out = hypothesis_crosscheck(id="free-fall-with-linear-drag")
    assert "```json" in out, "expected an embedded raw-JSON block"
    assert "\\u00b7" not in out, "dimension separator was escaped instead of literal"
    assert "\\u2014" not in out, "em dash was escaped instead of literal"
    assert "·" in out, "expected a literal dimension separator in the block"
