---
title: 'Lemma: an open verification substrate for AI-driven scientific computing'
tags:
  - scientific computing
  - verification
  - reproducibility
  - large language models
  - Model Context Protocol
  - Python
  - TypeScript
authors:
  - name: Arsalan Akhtar
    orcid: 0000-0002-4982-5906
    affiliation: 1
affiliations:
  - name: Atomira Technologies, S.L., Barcelona, Spain
    index: 1
date: 16 June 2026
bibliography: paper.bib
---

# Summary

AI assistants now routinely write scientific code — simulation drivers,
analysis scripts, numerical solvers, data pipelines — and produce scientific
results. Their output is usually syntactically correct and runs, but whether
the number it returns is *correct* (dimensionally consistent, within physical
bounds, faithful to the governing equations) is a separate question the model
is not reliably equipped to answer about its own output.

`Lemma` is an open substrate that closes this gap by checking a model's output
against structured scientific knowledge, rather than by trying to make the
model itself more careful. It has four layers. The first is a corpus of
schema-validated **cards** — units of trusted scientific knowledge, each a JSON
record carrying a formula, the dimensions of its symbols, validation envelopes,
declared limiting behaviour, and citable references. The second is a pair of
generic **check engines**: one verifies a finished output against the
assertions declared in its card (the Universal Scientific Cross-check Engine,
USCE), and one cross-checks an AI-*proposed* new card against the existing
corpus and a set of universal priors (dimensional analysis, limit behaviour,
conservation laws, reference resolution) before it is allowed into the corpus.
The third is a **distribution** layer that exposes the substrate through the
Model Context Protocol (MCP) [@mcp2024], so it can be called from any modern AI
coding runtime instead of competing with one. The fourth is **provenance**:
every run can be turned into a citable record of the prompt, the cards used,
the artifact produced, and the verdict.

The substrate is released as open source: the card schema under MIT, the cards
corpus under CC-BY 4.0, and the engines and MCP server under Apache-2.0. The
first public release (v1) ships a corpus of 38 cards across 21 sub-domains
(33 principle cards, 3 operational cards, 2 hypothesis cards), a Python SDK
(`artano-lemma`), and an MCP server (`@artano-ai/mcp-server`) exposing six
tools: `cards_list`, `cards_get`, `ops_get`, `hypothesis_crosscheck`,
`usce_check`, and `rag_lookup`.

# Statement of need

Verification is widely identified as the binding bottleneck for AI-driven
scientific discovery: generation is cheap and getting cheaper, but trusting a
generated result still requires an expert to confirm it against established
knowledge [@cornelio2025verification]. Frontier models asked to find errors in
published scientific work detect only a small fraction of them
[@son2025spot], which shows that scaling the generator does not by itself
supply a trustworthy verification signal.

The most capable recent systems for AI-driven science are proprietary on
exactly this axis. ERA runs a tree search over model-generated code and depends
on a closed, task-specific signal to decide which candidate is good
[@aygun2026era]; Co-Scientist coordinates multiple agents and relies on an
LLM-as-judge for the same role [@gottweis2026coscientist]. Both are strong on
the *generation* half and both leave the *scoring* of a candidate as a closed,
per-task design problem. `Lemma` is the open answer to that constraint: a
standardised, declarative, citable account of what "correct" means that any
system — a tree search, a multi-agent pipeline, or a single coding assistant —
can score against. It sits one layer below the agent and is consumed by AI
coding runtimes rather than reimplementing them.

Two companion studies supply the empirical evidence that the substrate
discriminates correct from incorrect scientific code. A pilot ablation on a
73-prompt benchmark across seven scientific domains shows that the engine's
verdict, used as a sampling-time reranker, selects the same candidate as a
ground-truth oracle on the large majority of prompts [@akhtar2026pilot]; a
follow-up generalises this into *verifier-guided sampling* and shows the effect
replicates across two open-weights model families and a range of sample budgets
[@akhtar2026vgs]. This software paper describes the substrate that made those
results possible and that others can now build on; it does not re-argue the
empirical findings.

`Lemma` is designed for two audiences. Researchers and engineers who write
scientific code with AI assistance can call the substrate from their existing
runtime through the MCP server to gate outputs before trusting them. Method
developers and tool builders can consume the schema and engines directly
through the Python SDK to add verification to their own pipelines, or contribute
new cards to the corpus — the schema is open and the corpus is citable, so
authorship of a card accrues attribution through an **Open Cards Economy** that
aligns the production of structured scientific knowledge with its use.

# Functionality and current scope

The v1 engines verify declared limits and conservation laws *declaratively* —
they record the claim and surface it as pending — rather than discharging it
symbolically. Dimensional consistency is checked mechanically, including
derivation of the dimensions of a declared formula from its symbols.
Symbolic discharge of limit and conservation claims (for example via a
SymPy/PySR adapter), per-card DOIs through Zenodo, and federated private cards
for regulated settings are on the v2 roadmap. Cards and engines are versioned,
and every provenance record pins the exact versions used, so a result verified
under v1 stays reproducible as the substrate evolves.

# Acknowledgements

This work was conducted as company-funded research and development within
Atomira Technologies, S.L. (Barcelona). The author is the sole administrator
and shareholder of the company, which develops `Lemma` and commercial products
built on it; no external sponsorship influenced the design or the conclusions.

# References
