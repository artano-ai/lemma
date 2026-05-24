"""Command-line entry point — small surface for inspecting the corpus.

* ``lemma list`` — print every card id and domain
* ``lemma show <id>`` — print one card as JSON
* ``lemma paths`` — print the resolved cards and schema paths
"""

from __future__ import annotations

import argparse
import json
import sys

from .cards import CARDS_DIR, SCHEMA_PATH, load_cards
from .version import __version__


def _cmd_list(_: argparse.Namespace) -> int:
    for card in load_cards():
        print(f"{card.id:50s} {card.kind:12s} {card.domain}")
    return 0


def _cmd_show(args: argparse.Namespace) -> int:
    for card in load_cards():
        if card.id == args.id:
            json.dump(card.raw, sys.stdout, indent=2)
            sys.stdout.write("\n")
            return 0
    print(f"unknown card id: {args.id}", file=sys.stderr)
    return 1


def _cmd_paths(_: argparse.Namespace) -> int:
    print(f"cards:  {CARDS_DIR}")
    print(f"schema: {SCHEMA_PATH}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lemma")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list every card").set_defaults(func=_cmd_list)
    sub.add_parser("paths", help="print resolved cards / schema paths").set_defaults(func=_cmd_paths)
    show = sub.add_parser("show", help="print one card as JSON")
    show.add_argument("id")
    show.set_defaults(func=_cmd_show)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
