# Using the Python SDK

`artano-lemma` is the Python distribution of Lemma. It targets the
same surface as the Node MCP server but lets you call the engine
in-process from a Jupyter notebook or a Python script, without going
through the MCP protocol.

## Install

```sh
pip install artano-lemma
```

## Quick check

After install, a `lemma` command is on your `PATH`:

```sh
lemma paths        # show where the cards corpus and schema resolve
lemma list         # list every card
lemma show free-fall-uniform-gravity
```

## Use it from Python

```py
from artano_lemma import load_cards, Card

# Read the bundled corpus
cards = load_cards()
print(f"{len(cards)} cards loaded")

# Filter to one domain
condensed_matter = [c for c in cards if c.domain.startswith("physics-condensed-matter")]
for c in condensed_matter:
    print(c.id, c.kind)

# Inspect a single card
card = next(c for c in cards if c.id == "free-fall-uniform-gravity")
print(card.title)
print(card.raw["formula"]["expression"])
```

## Use it from a notebook

A typical notebook pattern:

```py
import json
from artano_lemma import load_cards

cards = load_cards()
domains = {c.domain for c in cards}

print(f"Corpus: {len(cards)} cards across {len(domains)} domains.")
print("Available principle cards:")
for c in sorted(cards, key=lambda x: x.id):
    if c.kind == "principle":
        print(f"  {c.id:50s}  {c.domain}")
```

## Pointing at a different corpus

By default the SDK reads from the bundled corpus shipped inside the
package. To point at a different corpus (a private fork, an
unreleased card you are drafting), pass an explicit path:

```py
from pathlib import Path
from artano_lemma import load_cards

cards = load_cards(Path("/path/to/your/cards"))
```

## Status

The cards loader and the CLI are usable today. The cross-check
engine and the MCP client are work in progress; for production
verification today, prefer the Node MCP server.

## See also

* The SDK's own README in [`../sdk-py/README.md`](https://github.com/artano-ai/lemma/blob/main/sdk-py/README.md).
* [`what-is-a-card.md`](./what-is-a-card.md) for the data model.
* [`mcp-server.md`](./mcp-server.md) for the Node alternative.
