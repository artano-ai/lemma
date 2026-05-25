---
title: Lemma docs
hide:
  - navigation
  - toc
---

# Lemma

**The open verification substrate for AI-generated scientific code.**

A schema-validated cards corpus, a multi-axis verification engine,
an MCP server, and a Python SDK. Any agent that writes scientific
code can call Lemma to check the output against known physics,
chemistry, biology, climate, mathematics, engineering, and
numerical-method principles.

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } **Get started**

    ---

    Five minutes to your first verification — install the MCP
    server or the Python SDK and inspect the bundled cards corpus.

    [:octicons-arrow-right-24: Getting started](getting-started.md)

-   :material-cards-outline:{ .lg .middle } **Cards**

    ---

    The data model. Every card is one of four discriminated
    variants — principle, ops, hypothesis, unidentified — sharing
    the same JSON-Schema-validated shape.

    [:octicons-arrow-right-24: What is a card](what-is-a-card.md)

-   :material-server-network:{ .lg .middle } **MCP server**

    ---

    `@artano-ai/mcp-server` exposes the engine to Claude Code,
    Cursor, Codex, Goose, and any MCP-aware runtime.

    [:octicons-arrow-right-24: MCP server](mcp-server.md)

-   :material-language-python:{ .lg .middle } **Python SDK**

    ---

    `artano-lemma` reads the corpus and calls the engine
    in-process. Notebook-first; no MCP protocol overhead when you
    don't need it.

    [:octicons-arrow-right-24: Python SDK](sdk-py.md)

-   :material-graph:{ .lg .middle } **Architecture**

    ---

    The two engines (USCE + cross-check), the four ISEE phases,
    and the "refusing to fabricate is a feature" principle.

    [:octicons-arrow-right-24: Architecture](architecture.md)

-   :material-source-pull:{ .lg .middle } **Contribute a card**

    ---

    The bronze / silver / gold review tiers, the workflow for
    proposing a new card, and the rules of what we will and won't
    merge.

    [:octicons-arrow-right-24: Contributing cards](contributing-cards.md)

</div>

---

## Quick install

=== "Node — MCP server"

    ```sh
    npx @artano-ai/mcp-server
    ```

    Then add to your agent runtime config (Claude Code, Cursor,
    Codex, …):

    ```json
    {
      "mcpServers": {
        "lemma": {
          "command": "npx",
          "args": ["@artano-ai/mcp-server"]
        }
      }
    }
    ```

=== "Python — in-process SDK"

    ```sh
    pip install artano-lemma
    ```

    Then from a notebook or script:

    ```py
    from artano_lemma import load_cards, run_hypothesis_checks
    cards = load_cards()
    verdict = run_hypothesis_checks(my_hypothesis, corpus=cards)
    print(verdict.overall.severity, verdict.diagnosis)
    ```

=== "Python — also as MCP server"

    Lemma ships its own Python MCP server too — useful if your
    deployment can't run Node.

    ```sh
    pip install artano-lemma
    lemma-mcp
    ```

    Same tool surface as `@artano-ai/mcp-server`. Same JSON Schema.
    Same verdicts.

---

## Licences

| Component | Licence |
| --- | --- |
| `schema/` (the wire format) | MIT |
| `cards/` (the corpus) | CC-BY 4.0 |
| `mcp-server/` (Node) | Apache-2.0 |
| `sdk-py/` (Python) | Apache-2.0 |

See the [Contributing guide](contributing-cards.md) for what
attribution means when you reuse the corpus.

---

## Stewardship

Lemma is stewarded by **[Atomira Technologies, S.L.](https://atomira.eu)**
(Barcelona) and developed in the open at
[`github.com/artano-ai/lemma`](https://github.com/artano-ai/lemma).
