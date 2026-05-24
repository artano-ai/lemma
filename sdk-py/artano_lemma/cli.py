"""Command-line entry point for ``lemma``.

A small inspection surface over the bundled cards corpus, rendered
with Typer + Rich.

* ``lemma list``     — print every card id with its kind and domain
* ``lemma show <id>``— pretty-print one card as syntax-highlighted JSON
* ``lemma paths``    — print resolved cards / schema paths
"""

from __future__ import annotations

import json
import sys

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
    """List every card with its kind and domain."""
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
    table.add_column("domain", style="dim")

    for card in cards:
        kind_style = KIND_STYLE.get(card.kind, "white")
        table.add_row(card.id, Text(card.kind, style=kind_style), card.domain)

    console.print(table)


@app.command("show")
def show_cmd(
    card_id: str = typer.Argument(..., help="The card id to display."),
) -> None:
    """Pretty-print one card as syntax-highlighted JSON."""
    for card in load_cards():
        if card.id == card_id:
            kind_style = KIND_STYLE.get(card.kind, "white")
            subtitle = Text.assemble(
                (card.kind, kind_style),
                "  ·  ",
                (card.domain, "dim"),
            )
            console.print(
                Panel(
                    RichJSON(json.dumps(card.raw)),
                    title=f"[bold cyan]{card.id}[/bold cyan]",
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


def main() -> None:
    """Entrypoint invoked by the ``lemma`` script in pyproject.toml."""
    app()


if __name__ == "__main__":
    sys.exit(main())
