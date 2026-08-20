# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""``lemma verify`` and ``lemma crosscheck`` — the CLI verification surface.

These mirror the Node CLI's tests in ``lemma/cli/test/cli.test.ts`` on purpose.
Both packages install a binary called ``lemma`` and are documented as the same
tool over the same corpus, so the **exit-code contract must not drift between
them**:

* ``0`` — checked, and it passed
* ``1`` — checked, and the engine reported HIGH
* ``2`` — could not check at all (bad id, unreadable input, bad usage)

The 1/2 split is the load-bearing one. A pipeline that renders "the physics is
wrong" and "you typed the card id wrong" as the same red build teaches people to
mute the build.
"""

from __future__ import annotations

import json
import re

import pytest
from typer.testing import CliRunner

from artano_lemma.cli import app
from artano_lemma.symbolic import SYMPY_AVAILABLE

runner = CliRunner()


def invoke(*args: str, stdin: str | None = None):
    return runner.invoke(app, list(args), input=stdin)


def flat(text: str) -> str:
    """Collapse whitespace before matching.

    Rich hard-wraps to the terminal width, so a phrase can arrive split across
    a newline. These assertions are about *content* — asserting on the wrapped
    form would make them fail whenever the console width changes.
    """
    return re.sub(r"\s+", " ", text)


# --- exit codes --------------------------------------------------------------


def test_in_range_output_exits_zero():
    r = invoke("verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": 9.81}')
    assert r.exit_code == 0


def test_out_of_range_output_exits_one_not_two():
    r = invoke("verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": 42}')
    assert r.exit_code == 1, "a real envelope violation must be exit 1"


def test_unknown_card_exits_two_not_one():
    r = invoke("verify", "no-such-card", "--output", '{"a": 1}')
    assert r.exit_code == 2, "a usage fault must not look like a failed verification"


def test_malformed_json_exits_two():
    assert invoke("verify", "free-fall-uniform-gravity", "--output", "{not json").exit_code == 2


def test_missing_output_exits_two():
    assert invoke("verify", "free-fall-uniform-gravity").exit_code == 2


# --- an absent check is not a passing one ------------------------------------


def test_zero_check_run_passes_by_default_but_says_so():
    r = invoke("verify", "free-fall-uniform-gravity", "--output", '{"unrelatedKey": 1}')
    assert r.exit_code == 0
    assert "0 of 0 checks passed" in flat(r.output)
    assert "nothing to check" in flat(r.output), "the engine diagnosis must be surfaced, not swallowed"


def test_require_checks_turns_silence_into_failure():
    r = invoke(
        "verify",
        "free-fall-uniform-gravity",
        "--output",
        '{"unrelatedKey": 1}',
        "--require-checks",
    )
    assert r.exit_code == 1
    assert "an absent check must not be mistaken for a passing one" in flat(r.output)


# --- values are refused rather than coerced ----------------------------------


def test_a_numeric_string_is_not_silently_converted():
    # "9.81" would pass if coerced, making the verdict depend on a conversion
    # the caller never asked for.
    r = invoke("verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": "9.81"}')
    assert r.exit_code == 2


def test_a_bool_is_refused_even_though_python_calls_it_an_int():
    # `isinstance(True, int)` is True in Python, so a naive numeric check lets
    # `true` through and compares it as 1.0. This is a Python-specific trap the
    # Node CLI does not have, which is exactly why it needs its own test.
    r = invoke("verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": true}')
    assert r.exit_code == 2


def test_an_empty_output_is_refused():
    assert invoke("verify", "free-fall-uniform-gravity", "--output", "{}").exit_code == 2


# --- crosscheck --------------------------------------------------------------

BROKEN_DRAFT = {
    "kind": "hypothesis",
    "id": "draft-broken",
    "version": "0.1.0",
    "name": "Declares energy, computes momentum",
    "proposal": "E = (1/2) m v",
    "proposedFormulaTeX": "E = \\tfrac{1}{2} m v",
    "origin": "llm",
    "references": ["test fixture"],
    "checks": {
        "dimensional": {
            "lhsLabel": "E [J]",
            "lhsDims": {"M": 1, "L": 2, "T": -2},
            "rhsLabel": "(1/2) m v [J]",
            "rhsDims": {"M": 1, "L": 2, "T": -2},
            "expr": "(1/2)*m*v",
            "symbols": {"m": {"M": 1}, "v": {"L": 1, "T": -1}},
        }
    },
}


def test_a_corpus_hypothesis_card_passes_its_hard_checks():
    assert invoke("crosscheck", "free-fall-with-linear-drag").exit_code == 0


def test_recorded_but_undischarged_claims_do_not_fail_the_build():
    # A `warn` means the engine declined to answer. Failing on it would punish
    # authors for writing down claims the engine cannot yet check.
    r = invoke("crosscheck", "free-fall-with-linear-drag")
    assert "warn" in r.output
    assert r.exit_code == 0


def test_a_broken_draft_is_caught_from_stdin(tmp_path):
    r = invoke("crosscheck", "-", stdin=json.dumps(BROKEN_DRAFT))
    assert r.exit_code == 1
    assert "Dimensional mismatch" in flat(r.output)


def test_a_broken_draft_is_caught_from_a_file(tmp_path):
    path = tmp_path / "broken.json"
    path.write_text(json.dumps(BROKEN_DRAFT))
    r = invoke("crosscheck", str(path))
    assert r.exit_code == 1


def test_a_non_hypothesis_target_is_a_usage_error():
    assert invoke("crosscheck", "ideal-gas-law").exit_code == 2


def test_an_unreadable_target_is_a_usage_error():
    assert invoke("crosscheck", "./no/such/file.json").exit_code == 2


# --- the one thing only this runtime can do ----------------------------------


@pytest.mark.skipif(not SYMPY_AVAILABLE, reason="sympy not installed")
def test_symbolic_discharges_claims_the_node_cli_structurally_cannot():
    """``--symbolic`` has no counterpart in ``@artano-ai/cli`` — there is no
    comparable CAS in that ecosystem. This is the sole runtime where a declared
    limit or conservation claim can be *proven* from a shell."""
    recorded = invoke("crosscheck", "lotka-volterra-with-logistic-prey")
    proven = invoke("crosscheck", "lotka-volterra-with-logistic-prey", "--symbolic")

    assert "3 of 7 checks passed" in flat(recorded.output)
    assert "7 of 7 checks passed" in flat(proven.output)
    assert recorded.exit_code == 0 and proven.exit_code == 0


# --- filters -----------------------------------------------------------------


def test_kind_filter_works_because_the_error_hints_point_at_it():
    # `verify` on an unknown id tells the user to run `lemma list --kind
    # principle`. That hint has to be a command that exists.
    assert invoke("list", "--kind", "principle").exit_code == 0
    assert invoke("list", "--kind", "hypothesis").exit_code == 0


def test_an_unknown_kind_is_a_usage_error():
    assert invoke("list", "--kind", "nonsense").exit_code == 2


# --- json --------------------------------------------------------------------


def test_json_output_is_parseable():
    r = invoke(
        "verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": 9.81}', "--json"
    )
    assert r.exit_code == 0
    parsed = json.loads(r.output)
    assert parsed["card"] == "free-fall-uniform-gravity"
    assert parsed["overall"]["severity"] == "NONE"


def test_a_failing_verify_still_emits_valid_json():
    r = invoke(
        "verify", "free-fall-uniform-gravity", "--output", '{"gEarth_m_per_s2": 42}', "--json"
    )
    assert r.exit_code == 1
    assert json.loads(r.output)["overall"]["severity"] == "HIGH"
