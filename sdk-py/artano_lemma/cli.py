# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Command-line entry point for ``lemma``.

Verification plus an inspection surface over the cards corpus, rendered
with Typer + Rich, plus an MCP server entry point.

* ``lemma verify <id> --output '{...}'`` — range-check a finished output
  against a card's validation envelopes
* ``lemma crosscheck <id|file|->``       — cross-check a proposed principle,
  from the corpus or a draft
* ``lemma list``                — print every card id with its kind, name, and domain
* ``lemma show <id>``           — pretty-print one card as syntax-highlighted JSON
* ``lemma paths``               — print resolved cards / schema paths
* ``lemma authors <id>``        — show every contributor who touched the card (from git log)
* ``lemma serve``               — run the Lemma MCP server over stdio (alias for ``lemma-mcp``)

``@artano-ai/cli`` on npm installs a ``lemma`` binary too, and the two are the
same tool over the same corpus and the same engine contract — the overlapping
commands are spelled identically and the exit codes match.

The one command that exists **only here** is ``crosscheck --symbolic``. There
is no comparable computer-algebra system in the Node ecosystem, so this is the
sole runtime where a declared limit or conservation claim can be *proven* from
a shell rather than recorded.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import typer
from rich.box import ROUNDED
from rich.console import Console
from rich.json import JSON as RichJSON
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .cards import CARDS_DIR, SCHEMA_PATH, find_card, load_cards
from .symbolic import SYMPY_AVAILABLE
from .version import __version__


app = typer.Typer(
    add_completion=False,
    rich_markup_mode="rich",
    no_args_is_help=True,
    help=(
        "[bold cyan]lemma[/bold cyan] — open verification substrate for AI-generated scientific code.\n"
        "Python SDK for the bundled cards corpus."
    ),
)
console = Console()
err_console = Console(stderr=True)


def _version_callback(value: bool) -> None:
    if value:
        console.print(f"[bold cyan]lemma[/bold cyan] [dim]v{__version__}[/dim]")
        raise typer.Exit()


@app.callback()
def _main_callback(
    version: bool = typer.Option(
        False,
        "--version",
        "-V",
        callback=_version_callback,
        is_eager=True,
        help="Show the installed version and exit.",
    ),
) -> None:
    """Inspect the Lemma cards corpus."""


KIND_STYLE = {
    "principle": "bold green",
    "ops": "bold blue",
    "hypothesis": "bold yellow",
    "unidentified": "bold red",
}


@app.command("list")
def list_cmd(
    kind: str = typer.Option(None, "--kind", help="Filter by principle, ops, or hypothesis."),
    domain: str = typer.Option(None, "--domain", help="Filter by domain prefix, e.g. physics."),
) -> None:
    """List every card with its kind, name, and domain."""
    cards = load_cards()

    if kind:
        if kind.lower() not in {"principle", "ops", "hypothesis"}:
            _usage_error(
                f'Unknown kind "{kind}".',
                "Expected principle, ops, or hypothesis.",
            )
        cards = [c for c in cards if c.kind == kind.lower()]
    if domain:
        needle = domain.lower()
        cards = [c for c in cards if (getattr(c, "domain", None) or "").lower().startswith(needle)]

    table = Table(
        title=f"[bold cyan]Lemma cards[/bold cyan] [dim]({len(cards)} total)[/dim]",
        box=ROUNDED,
        header_style="bold magenta",
        show_lines=False,
        expand=False,
    )
    table.add_column("id", style="cyan", no_wrap=True)
    table.add_column("kind", no_wrap=True)
    table.add_column("name", style="white")
    table.add_column("domain", style="dim")

    for card in cards:
        kind_style = KIND_STYLE.get(card.kind, "white")
        domain = getattr(card, "domain", None) or "—"
        table.add_row(
            card.id,
            Text(card.kind, style=kind_style),
            card.name,
            domain,
        )

    console.print(table)


@app.command("show")
def show_cmd(
    card_id: str = typer.Argument(..., help="The card id to display."),
) -> None:
    """Pretty-print one card as syntax-highlighted JSON."""
    for card in load_cards():
        if card.id == card_id:
            kind_style = KIND_STYLE.get(card.kind, "white")
            domain = getattr(card, "domain", None) or card.kind
            subtitle = Text.assemble(
                (card.kind, kind_style),
                "  ·  ",
                (domain, "dim"),
            )
            console.print(
                Panel(
                    RichJSON(card.model_dump_json(exclude_none=True)),
                    title=f"[bold cyan]{card.id}[/bold cyan] [dim]· {card.name}[/dim]",
                    subtitle=subtitle,
                    border_style="cyan",
                    box=ROUNDED,
                    padding=(1, 2),
                )
            )
            return

    err_console.print(
        Panel(
            f"[red]Unknown card id:[/red] [bold]{card_id}[/bold]\n\n"
            "[dim]Run [/dim][cyan]lemma list[/cyan][dim] to see every card.[/dim]",
            border_style="red",
            box=ROUNDED,
            padding=(1, 2),
        )
    )
    raise typer.Exit(code=1)


@app.command("paths")
def paths_cmd() -> None:
    """Print resolved cards and schema paths."""
    table = Table(box=ROUNDED, show_header=False, expand=False, padding=(0, 2))
    table.add_column("", style="bold magenta")
    table.add_column("", style="cyan")
    table.add_row("cards", str(CARDS_DIR))
    table.add_row("schema", str(SCHEMA_PATH))

    console.print(
        Panel(
            table,
            title="[bold cyan]Lemma paths[/bold cyan]",
            border_style="cyan",
            box=ROUNDED,
        )
    )


@app.command("authors")
def authors_cmd(
    card_id: str = typer.Argument(..., help="The card id to look up."),
    git: bool = typer.Option(
        False,
        "--git",
        help="Show the git-log history instead of the card's declared authorship.",
    ),
) -> None:
    """Show who a card credits.

    Prefers the card's own ``metadata.authors`` block, because that
    travels with the JSON: a repo move, a squashed history or a fresh
    clone without full history all erase git log, and CC-BY attribution
    has to survive those. Falls back to ``git log`` when a card declares
    no authorship, and ``--git`` forces the history view.
    """
    card_path = _find_card_path(card_id)
    if card_path is not None and not git:
        declared = _declared_authors(card_path)
        if declared is not None:
            _print_declared_authors(card_id, card_path, declared)
            return

    if card_path is None:
        err_console.print(
            Panel(
                f"[red]Unknown card id:[/red] [bold]{card_id}[/bold]\n\n"
                "[dim]Run [/dim][cyan]lemma list[/cyan][dim] to see every card.[/dim]",
                border_style="red",
                box=ROUNDED,
                padding=(1, 2),
            )
        )
        raise typer.Exit(code=1)

    entries = _git_log_for(card_path)

    if not entries:
        err_console.print(
            Panel(
                Text.assemble(
                    ("No git history found for ", "yellow"),
                    (str(card_path.relative_to(CARDS_DIR.parent)), "bold"),
                    ("\n\nThe card exists on disk but git has no commits "
                     "touching its path. This usually means the corpus "
                     "wasn't cloned with full history, or the card is "
                     "uncommitted.", "dim"),
                ),
                title=f"[bold yellow]{card_id}[/bold yellow]",
                border_style="yellow",
                box=ROUNDED,
                padding=(1, 2),
            )
        )
        raise typer.Exit(code=1)

    table = Table(
        box=ROUNDED,
        header_style="bold magenta",
        show_lines=False,
        expand=False,
    )
    table.add_column("date", style="dim", no_wrap=True)
    table.add_column("author", style="cyan", no_wrap=True)
    table.add_column("email", style="dim")
    table.add_column("commit", style="dim", no_wrap=True)
    table.add_column("subject", style="white")

    for entry in entries:
        table.add_row(
            entry["date"],
            entry["author"],
            entry["email"],
            entry["sha"],
            entry["subject"],
        )

    distinct_authors = sorted({(e["author"], e["email"]) for e in entries})
    summary = Text.assemble(
        (str(len(entries)), "bold cyan"),
        (" commit", "dim"),
        ("s" if len(entries) != 1 else "", "dim"),
        ("  ·  ", "dim"),
        (str(len(distinct_authors)), "bold cyan"),
        (" distinct contributor", "dim"),
        ("s" if len(distinct_authors) != 1 else "", "dim"),
    )

    console.print(
        Panel(
            table,
            title=f"[bold cyan]{card_id}[/bold cyan] [dim]· authors from git log[/dim]",
            subtitle=summary,
            border_style="cyan",
            box=ROUNDED,
            padding=(1, 2),
        )
    )
    console.print(
        "[dim]This view is git-log-derived: the card declares no "
        "[cyan]metadata.authors[/cyan]. Git history is brittle "
        "attribution — a repo move or a squashed history erases it — so "
        "prefer declaring authorship in the card itself.[/dim]"
    )


def _declared_authors(card_path: Path) -> dict[str, object] | None:
    """Return a card's ``metadata`` block, or None when it declares none."""
    try:
        payload = json.loads(card_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    metadata = payload.get("metadata") if isinstance(payload, dict) else None
    if not isinstance(metadata, dict) or not metadata.get("authors"):
        return None
    return metadata


_TIER_STYLE = {"gold": "yellow", "silver": "white", "bronze": "red"}


def _print_declared_authors(
    card_id: str, card_path: Path, metadata: dict[str, object]
) -> None:
    """Render the authorship a card declares about itself."""
    authors = metadata.get("authors")
    authors_list = authors if isinstance(authors, list) else []

    table = Table(box=ROUNDED, header_style="bold magenta", expand=False)
    table.add_column("author", style="cyan", no_wrap=True)
    table.add_column("role", style="dim", no_wrap=True)
    table.add_column("orcid", style="dim", no_wrap=True)
    table.add_column("github", style="dim", no_wrap=True)

    for author in authors_list:
        if not isinstance(author, dict):
            continue
        table.add_row(
            str(author.get("name", "")),
            str(author.get("role", "—")),
            str(author.get("orcid", "—")),
            str(author.get("github", "—")),
        )

    tier = metadata.get("tier")
    parts: list[tuple[str, str]] = [
        (str(len(authors_list)), "bold cyan"),
        (" author" + ("s" if len(authors_list) != 1 else ""), "dim"),
    ]
    if isinstance(tier, str):
        parts += [("  ·  tier ", "dim"), (tier, _TIER_STYLE.get(tier, "white"))]
    for key in ("created", "updated"):
        value = metadata.get(key)
        if isinstance(value, str):
            parts += [(f"  ·  {key} ", "dim"), (value, "white")]

    console.print(
        Panel(
            table,
            title=f"[bold cyan]{card_id}[/bold cyan] [dim]· declared in the card[/dim]",
            subtitle=Text.assemble(*parts),
            border_style="cyan",
            box=ROUNDED,
            padding=(1, 2),
        )
    )
    console.print(
        f"[dim]Cited as CC-BY 4.0 from [/dim]"
        f"[cyan]{card_path.relative_to(CARDS_DIR.parent)}[/cyan]"
        f"[dim].  Run [/dim][cyan]lemma authors {card_id} --git[/cyan]"
        f"[dim] for the commit history.[/dim]"
    )


def _find_card_path(card_id: str) -> Path | None:
    """Return the on-disk path of the card with this id, or None."""
    for entry in CARDS_DIR.rglob("*.json"):
        try:
            payload = json.loads(entry.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and payload.get("id") == card_id:
            return entry
    return None


def _git_log_for(path: Path) -> list[dict[str, str]]:
    """Run ``git log`` against ``path`` and return one dict per commit.

    Empty list if the path is not under a git repository or has no
    commits.
    """
    # ISO 8601 date · author name · email · short sha · subject — pipe-delimited so
    # we can parse robustly even when subjects contain commas.
    fmt = "%ad|%an|%ae|%h|%s"
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(CARDS_DIR.parent),
                "log",
                "--follow",
                f"--pretty=format:{fmt}",
                "--date=short",
                "--",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []

    if result.returncode != 0 or not result.stdout.strip():
        return []

    entries: list[dict[str, str]] = []
    for line in result.stdout.strip().splitlines():
        parts = line.split("|", 4)
        if len(parts) < 5:
            continue
        date, author, email, sha, subject = parts
        entries.append(
            {
                "date": date,
                "author": author,
                "email": email,
                "sha": sha,
                "subject": subject,
            }
        )
    return entries


# ---------------------------------------------------------------------------
# Verification
#
# Exit codes match `@artano-ai/cli` exactly, and the contract matters more than
# the wording:
#
#   0  checked, and it passed
#   1  checked, and the engine reported HIGH
#   2  could not check at all — bad id, unreadable input, bad usage
#
# The 1/2 split is the load-bearing one. A pipeline that renders "the physics is
# wrong" and "you typed the card id wrong" as the same red build teaches people
# to mute the build.
#
# Check prose is printed verbatim. Both engines are contracted to byte-identical
# detail strings and a fixture in ``lemma/parity/`` enforces it; paraphrasing
# here would make the two CLIs describe one verdict in two voices.
# ---------------------------------------------------------------------------

SEVERITY_STYLE = {"NONE": "green", "LOW": "yellow", "MEDIUM": "yellow", "HIGH": "red"}
CHECK_STYLE = {"pass": "green", "warn": "yellow", "fail": "red"}


def _usage_error(message: str, hint: str = "") -> None:
    body = f"[red]{message}[/red]"
    if hint:
        body += f"\n\n[dim]{hint}[/dim]"
    err_console.print(Panel(body, border_style="red", box=ROUNDED, padding=(1, 2)))
    raise typer.Exit(code=2)


def _read_output(output: str | None, output_file: str | None) -> dict[str, float]:
    """Parse the observable map, refusing anything that is not a finite number."""
    if output_file:
        try:
            raw = sys.stdin.read() if output_file == "-" else Path(output_file).read_text()
        except OSError as exc:
            _usage_error(f"Cannot read {output_file}: {exc}")
    elif output:
        raw = output
    else:
        _usage_error(
            "Nothing to check.",
            "Pass --output '{\"key\": 1.23}' or --output-file <path|-> .",
        )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        _usage_error(f"Output is not valid JSON: {exc}")
    if not isinstance(parsed, dict):
        _usage_error("Output must be a JSON object mapping envelope keys to numbers.")

    result: dict[str, float] = {}
    for key, value in parsed.items():
        # Refuse rather than coerce. A quoted "9.81" that silently became a
        # number would make the verdict depend on a conversion the caller never
        # asked for, and bool is an int in Python — so True would sneak through
        # an isinstance check and compare as 1.0.
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            _usage_error(
                f'Output key "{key}" is {json.dumps(value)}; every value must be a number.'
            )
        if value != value or value in (float("inf"), float("-inf")):
            _usage_error(f'Output key "{key}" is not finite.')
        result[key] = float(value)

    if not result:
        _usage_error("Output is empty — there is nothing to check.")
    return result


def _read_json_file(path: str, label: str):
    try:
        raw = sys.stdin.read() if path == "-" else Path(path).read_text()
    except OSError as exc:
        _usage_error(f"Cannot read {label} from {path}: {exc}")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        _usage_error(f"{label} is not valid JSON: {exc}")


def _read_series(path: str) -> dict[str, list[float]]:
    parsed = _read_json_file(path, "series data")
    if not isinstance(parsed, dict):
        _usage_error("Series data must be a JSON object mapping each quantity to its samples.")
    out: dict[str, list[float]] = {}
    for key, value in parsed.items():
        if not isinstance(value, list) or any(
            isinstance(v, bool) or not isinstance(v, (int, float)) for v in value
        ):
            _usage_error(f'Series "{key}" must be an array of numbers.')
        out[key] = [float(v) for v in value]
    return out


def _read_refinement(path: str) -> list[tuple[float, float]]:
    parsed = _read_json_file(path, "refinement study")
    ok = isinstance(parsed, list) and all(
        isinstance(pt, list)
        and len(pt) == 2
        and all(not isinstance(v, bool) and isinstance(v, (int, float)) for v in pt)
        for pt in parsed
    )
    if not ok:
        _usage_error(
            "A refinement study must be an array of [h, error] pairs, e.g. "
            "[[0.1, 1e-3], [0.05, 2.5e-4]]."
        )
    return [(float(a), float(b)) for a, b in parsed]


def _print_result(heading: str, card_id: str, card_name: str, result) -> None:
    console.print(f"[bold]{heading}[/bold] [dim]·[/dim] [cyan]{card_id}[/cyan] [dim]· {card_name}[/dim]")
    for check in result.checks:
        style = CHECK_STYLE.get(check.severity, "white")
        console.print(f"  [{style}]{check.severity:>4}[/{style}]  {check.detail}", highlight=False)
    severity = result.overall.severity
    style = SEVERITY_STYLE.get(severity, "white")
    console.print(
        f"[dim]—[/dim] [{style}]{result.overall.passing} of {result.overall.total} "
        f"checks passed · severity {severity}[/{style}]"
    )
    console.print(f"[dim]{result.diagnosis}[/dim]", highlight=False)


@app.command("verify")
def verify_cmd(
    card_id: str = typer.Argument(..., help="Principle card to check against."),
    output: str = typer.Option(None, "--output", help='Inline JSON, e.g. \'{"key": 1.23}\'.'),
    output_file: str = typer.Option(
        None, "--output-file", help="Read that JSON from a file, or '-' for stdin."
    ),
    series: str = typer.Option(
        None,
        "--series",
        help="JSON of quantity -> samples, checked against the card's seriesConditions.",
    ),
    refinement: str = typer.Option(
        None,
        "--refinement",
        help="JSON array of [h, error] levels; recomputes the observed convergence order.",
    ),
    require_checks: bool = typer.Option(
        False,
        "--require-checks",
        help="Treat 'nothing was checked' as a failure. Use this in CI.",
    ),
    as_json: bool = typer.Option(False, "--json", help="Machine-readable output."),
) -> None:
    """Check a finished run against what the card declares.

    Three shapes of evidence, any combination: scalars against
    ``validationEnvelopes``, a series against ``seriesConditions``, and a
    refinement study against the declared convergence order. They report as one
    verdict because they describe one run — splitting them across invocations
    would make a pipeline decide which failures matter.
    """
    from .convergence import run_convergence_check
    from .engine import run_usce_checks
    from .series import run_series_checks

    card = find_card(card_id, load_cards())
    if card is None or card.kind != "principle":
        _usage_error(
            f'Unknown principle card: "{card_id}".',
            "Run `lemma list --kind principle` to see every card.",
        )

    sections: list[tuple[str, object]] = []
    if output or output_file:
        sections.append(
            ("envelopes", run_usce_checks(_read_output(output, output_file), card, require_checks))
        )
    if series:
        sections.append(("series", run_series_checks(_read_series(series), card)))
    if refinement:
        sections.append(("convergence", run_convergence_check(_read_refinement(refinement), card)))
    if not sections:
        _usage_error(
            "Nothing to check.",
            "Pass --output '{\"key\": 1.23}', --output-file <path|->, --series <path> "
            "or --refinement <path>.",
        )

    checks = [c for _, r in sections for c in r.checks]
    passing = sum(1 for c in checks if c.severity == "pass")
    # Aggregate from each section's OVERALL severity, not from the checks. With
    # --require-checks the engine reports HIGH on a run with *zero* checks —
    # that is the entire point of the flag — so deriving severity from the check
    # list alone silently drops it.
    severity = "HIGH" if any(r.overall.severity == "HIGH" for _, r in sections) else "NONE"

    if as_json:
        print(
            json.dumps(
                {
                    "card": card.id,
                    "requireChecks": require_checks,
                    "checks": [json.loads(c.model_dump_json()) for c in checks],
                    "diagnosis": " ".join(r.diagnosis for _, r in sections),
                    "overall": {"passing": passing, "total": len(checks), "severity": severity},
                    "sections": {
                        label: json.loads(r.model_dump_json()) for label, r in sections
                    },
                },
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        console.print(
            f"[bold]USCE[/bold] [dim]·[/dim] [cyan]{card.id}[/cyan] [dim]· {card.name}[/dim]"
        )
        for label, r in sections:
            if len(sections) > 1:
                console.print(f"[dim]{label}[/dim]")
            for check in r.checks:
                style = CHECK_STYLE.get(check.severity, "white")
                console.print(
                    f"  [{style}]{check.severity:>4}[/{style}]  {check.detail}", highlight=False
                )
        style = SEVERITY_STYLE.get(severity, "white")
        console.print(
            f"[dim]—[/dim] [{style}]{passing} of {len(checks)} checks passed · "
            f"severity {severity}[/{style}]"
        )
        for _, r in sections:
            console.print(f"[dim]{r.diagnosis}[/dim]", highlight=False)
        if not checks and not require_checks:
            console.print(
                "[dim]hint:[/dim] [cyan]--require-checks[/cyan] "
                "[dim]makes a zero-check run a failure.[/dim]"
            )

    raise typer.Exit(code=1 if severity == "HIGH" else 0)


@app.command("crosscheck")
def crosscheck_cmd(
    target: str = typer.Argument(
        ..., help="Hypothesis card id in the corpus, a path to a draft, or '-' for stdin."
    ),
    symbolic: bool = typer.Option(
        False,
        "--symbolic",
        help="Discharge limit and conservation claims with SymPy instead of recording them.",
    ),
    as_json: bool = typer.Option(False, "--json", help="Machine-readable output."),
) -> None:
    """Cross-check a proposed principle against the corpus.

    Accepts a card already in the corpus or a draft you are writing — the
    draft case is the useful one, since a schema-valid but physically wrong
    card is cheapest to catch before review rather than during it.

    ``--symbolic`` has no counterpart in the Node CLI: there is no comparable
    computer-algebra system in that ecosystem, so this is the one runtime where
    a declared limit or conservation claim can actually be *proven* from a
    shell rather than merely recorded.
    """
    from .engine import run_hypothesis_checks
    from .types import HypothesisCard

    card = find_card(target, load_cards())
    if card is None:
        try:
            raw = sys.stdin.read() if target == "-" else Path(target).read_text()
        except OSError:
            _usage_error(
                f'"{target}" is neither a hypothesis card id nor a readable file.',
                "Run `lemma list --kind hypothesis` to see the corpus ids.",
            )
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as exc:
            _usage_error(f"{target} is not valid JSON: {exc}")
        if not isinstance(payload, dict) or payload.get("kind") != "hypothesis":
            _usage_error(
                f'{target} has kind "{payload.get("kind") if isinstance(payload, dict) else "?"}"; '
                'cross-check only applies to kind "hypothesis".'
            )
        try:
            card = HypothesisCard(**payload)
        except Exception as exc:  # noqa: BLE001 - a malformed draft is a usage fault
            _usage_error(f"{target} does not parse as a hypothesis card: {exc}")
    elif card.kind != "hypothesis":
        _usage_error(f'"{target}" is a {card.kind} card; cross-check applies to hypothesis cards.')

    if symbolic and not SYMPY_AVAILABLE:
        _usage_error(
            "--symbolic needs SymPy, which is not installed.",
            'Install it with: pip install "artano-lemma[symbolic]"',
        )

    corpus = [c for c in load_cards() if c.kind == "principle"]
    result = run_hypothesis_checks(card, corpus=corpus, symbolic=symbolic)

    if as_json:
        print(
            json.dumps(
                {"card": card.id, "symbolic": symbolic, **result.model_dump()},
                indent=2,
                ensure_ascii=False,
            )
        )
    else:
        _print_result("Cross-check", card.id, card.name, result)

    raise typer.Exit(code=1 if result.overall.severity == "HIGH" else 0)


@app.command("serve")
def serve_cmd() -> None:
    """Run the Lemma MCP server over stdio.

    Equivalent to the standalone ``lemma-mcp`` console script.
    Provided as an ``lemma`` subcommand for agent runtimes that
    prefer a single binary in their MCP config.
    """
    from .server import main as run_server

    run_server()


def main() -> None:
    """Entrypoint invoked by the ``lemma`` script in pyproject.toml."""
    app()


if __name__ == "__main__":
    sys.exit(main())
