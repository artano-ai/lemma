# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Cross-language parity: the Python half.

The engine ships twice — here and in ``mcp-server/src/cards/`` — and they are
contracted to return byte-identical verdicts *and* byte-identical prose. Until
this test existed, nothing enforced that: each language tested itself against
its own output, so both suites stayed green while the two drifted apart.

``../../parity/cases.json`` holds the shared golden values. Its TypeScript twin
is ``mcp-server/test/parity.test.ts``, reading the same file and asserting the
same way, so a drift in either language fails that language's own CI job —
which matters because no CI job has both runtimes installed.
"""

from __future__ import annotations

import json
import pathlib
from typing import Any

import pytest

from artano_lemma import SeriesCondition, run_convergence_check, run_series_checks
from artano_lemma import (
    HypothesisCard,
    PrincipleCard,
    run_agreement_checks,
    run_hypothesis_checks,
    run_usce_checks,
)

FIXTURE_PATH = pathlib.Path(__file__).resolve().parents[2] / "parity" / "cases.json"
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
CASES = FIXTURE["cases"]
SHARED = FIXTURE.get("shared", {})


def _resolve(value: Any) -> Any:
    """Cases share fixture cards by reference (``{"$use": ...}``) so the same
    card cannot drift between cases."""
    if isinstance(value, dict) and "$use" in value:
        return SHARED[value["$use"]]
    return value


def _run(case: dict[str, Any]) -> Any:
    i = case["input"]
    fn = case["fn"]
    if fn == "usce":
        return run_usce_checks(
            i["output"], PrincipleCard(**_resolve(i["card"])), i.get("requireChecks", False)
        )
    if fn == "hypothesis":
        return run_hypothesis_checks(
            HypothesisCard(**_resolve(i["card"])),
            corpus=[PrincipleCard(**c) for c in i.get("corpus", [])],
        )
    if fn == "agreement":
        return run_agreement_checks(i["outputs"], PrincipleCard(**_resolve(i["card"])))
    if fn == "series":
        def _cond(d: dict[str, Any]) -> SeriesCondition:
            w = d.get("where")
            return SeriesCondition(
                d["of"], d["op"], d["value"],
                where=SeriesCondition(w["of"], w["op"], w["value"]) if w else None,
            )
        # `conditions` absent means "read them from the card" — the same
        # fallback the TypeScript runner gets by passing undefined.
        declared = i.get("conditions")
        return run_series_checks(
            i["series"],
            PrincipleCard(**_resolve(i["card"])),
            [_cond(c) for c in declared] if declared is not None else None,
        )
    if fn == "convergence":
        return run_convergence_check(
            [tuple(pt) for pt in i["points"]], PrincipleCard(**_resolve(i["card"]))
        )
    raise AssertionError(f"unknown fn: {fn}")


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_matches_the_cross_language_golden(case: dict[str, Any]) -> None:
    try:
        actual = _run(case).model_dump()
    except (ValueError, TypeError) as err:
        # A refusal is part of the contract, so its message is pinned too.
        actual = {"threw": str(err)}

    assert actual == case["expected"], (
        f'Python output diverged from the golden value for "{case["id"]}". If this '
        f"wording change is intentional, regenerate per parity/README.md — from "
        f"BOTH languages, never one."
    )


def test_fixture_covers_every_engine_entry_point() -> None:
    """Every cross-language entry point must appear in the fixture.

    This guard is why adding ``convergence`` could not silently ship
    unparitied: the new entry point failed this assertion before it had
    cases, rather than after someone noticed a drift in production.
    """
    assert sorted({c["fn"] for c in CASES}) == [
        "agreement",
        "convergence",
        "hypothesis",
        "series",
        "usce",
    ]
