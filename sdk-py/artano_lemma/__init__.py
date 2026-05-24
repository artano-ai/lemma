"""Lemma — open verification substrate for AI-generated scientific code.

Python SDK. Parallel to the Node distribution at
``../mcp-server/`` (``@artano-ai/mcp-server``). Both speak the same
cards format, the same check verdicts, and the same Model Context
Protocol tools.

Public surface (alpha):

* ``artano_lemma.Card`` — typed representation of one card JSON file
* ``artano_lemma.load_cards`` — load every card under a directory
* ``artano_lemma.cards_root`` — path resolver for the bundled corpus
* ``artano_lemma.__version__``

Engine (cross-check + USCE) and the MCP client live in submodules and
are work in progress; the canonical implementation is the TypeScript
one at ``../mcp-server/`` for now.
"""

from .cards import Card, cards_root, load_cards
from .version import __version__

__all__ = ["Card", "cards_root", "load_cards", "__version__"]
