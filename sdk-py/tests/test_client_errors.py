"""The client must recognise a failed tool call on either ``mcp`` major.

``mcp`` 2.x renamed ``CallToolResult.isError`` to ``is_error``. The client
checked only the 1.x spelling, so against 2.x *every* call looked successful:
``cards_get`` on an unknown id returned the string "Error executing tool
cards_get: No card with id ..." to a caller expecting a card, and nothing
raised. The server was reporting the failure correctly the whole time.

This is unit-level on purpose. The round-trip test that caught it only runs
when ``lemma-mcp`` is on PATH, which it is in CI and is not on a typical
developer machine — so the defect was invisible locally while failing every CI
run. A test with no such precondition cannot hide that way.
"""

from __future__ import annotations

from artano_lemma.client import _is_error


class _Result:
    def __init__(self, **kw: object) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


def test_detects_the_2x_spelling() -> None:
    assert _is_error(_Result(is_error=True)) is True


def test_detects_the_1x_spelling() -> None:
    assert _is_error(_Result(isError=True)) is True


def test_successful_calls_are_not_errors() -> None:
    assert _is_error(_Result(is_error=False)) is False
    assert _is_error(_Result(isError=False)) is False


def test_absent_flag_is_not_an_error() -> None:
    # A result carrying neither attribute must not be read as a failure —
    # that would turn every successful call into an exception.
    assert _is_error(_Result()) is False


def test_truthy_is_not_enough() -> None:
    # Only an explicit True counts. A stray non-boolean must not be coerced
    # into a verdict about whether the science call succeeded.
    assert _is_error(_Result(is_error="no")) is False
