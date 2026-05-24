# Lemma — Python SDK

Pure-Python SDK for the Lemma verification substrate. Ships as
`artano-lemma`. Parallel to the Node distribution at
[`../mcp-server/`](../mcp-server/) (`@artano-ai/mcp-server`). Both
packages read the same shared `cards/` corpus and the same
`schema/card.v0.1.json`.

## Why a Python SDK

Scientific researchers already work in Python (NumPy, SciPy, Jupyter,
conda). A Python SDK lets a notebook call Lemma without spinning up a
separate Node process and without going through the MCP protocol when
in-process verification is enough.

## Install

```bash
pip install artano-lemma            # from PyPI
pip install -e ".[dev]"             # local development
```

## Commands

```bash
lemma paths        # show where cards/ and schema resolve
lemma list         # list every card
lemma show <id>    # print one card as JSON
```

## Layout

```
sdk-py/
├── pyproject.toml
├── README.md
├── artano_lemma/
│   ├── __init__.py
│   ├── version.py
│   ├── cards.py          Shared-corpus loader
│   └── cli.py            Command-line entry point
└── tests/
    └── test_cards.py
```
