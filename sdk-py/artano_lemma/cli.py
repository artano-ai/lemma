"""Command-line entry point for ``lemma``.

A small inspection surface over the bundled cards corpus, rendered
with Typer + Rich, plus an MCP server entry point.

* ``lemma list``                — print every card id with its kind, name, and domain
* ``lemma show <id>``           — pretty-print one card as syntax-highlighted JSON
* ``lemma paths``               — print resolved cards / schema paths
* ``lemma authors <id>``        — show every contributor who touched the card (from git log)
* ``lemma serve``               — run the Lemma MCP server over stdio (alias for ``lemma-mcp``)
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

from .cards import CARDS_DIR, SCHEMA_PATH, load_cards
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
def list_cmd() -> None:
    """List every card with its kind, name, and domain."""
    cards = load_cards()

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
) -> None:
    """Show every contributor who touched a card.

    Today this runs ``git log`` against the card's JSON file, since
    the schema v0.1 does not carry author metadata. When schema v0.2
    lands with the content / metadata split, this command will
    prefer the in-card ``metadata.authors[]`` field and fall back to
    git log only when it's absent.
    """
    card_path = _find_card_path(card_id)
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
        "[dim]Note: schema v0.1 has no in-card author metadata; "
        "this view is git-log-derived. Once schema v0.2 ships the "
        "content/metadata split, this command will prefer "
        "[cyan]metadata.authors[][/cyan] when present.[/dim]"
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
