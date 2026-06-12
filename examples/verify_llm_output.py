#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""
LLM-in-the-loop: ask a model to propose a physical law, then verify it.

Prompts a model (local Ollama by default, or any OpenAI-compatible endpoint)
to propose a new principle as a Lemma HypothesisCard, then runs Lemma's
cross-check engine on the model's *own output* and prints the verdict. This is
the "use Llama (or any model) to test the verification" loop — no benchmark
prompts needed.

Every failure mode is itself a demonstration: if the model returns non-JSON,
a schema-invalid card, or a dimensionally-wrong law, the substrate catches it.

Requirements:
    pip install -e ../sdk-py            # installs the engine + httpx
    # plus a model endpoint, e.g. local Ollama:
    #   ollama pull llama3.1:8b   (with `ollama serve` running)

Configure via env (defaults target local Ollama):
    LEMMA_LLM_BASE_URL   default http://localhost:11434/v1
    LEMMA_LLM_MODEL      default llama3.1:8b
    LEMMA_LLM_API_KEY    optional (for hosted OpenAI-compatible endpoints)

Run:
    python verify_llm_output.py
"""
import json
import os
import sys

import httpx

from artano_lemma import (
    CardValidationError,
    load_cards,
    parse_card,
    run_hypothesis_checks,
)

BASE_URL = os.environ.get("LEMMA_LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
MODEL = os.environ.get("LEMMA_LLM_MODEL", "llama3.1:8b")
API_KEY = os.environ.get("LEMMA_LLM_API_KEY")

CORPUS = load_cards()

SYSTEM = (
    "You are a physicist proposing a candidate principle for peer review. "
    "Return ONLY a single JSON object — a Lemma HypothesisCard — with no prose "
    "and no Markdown fences. Required fields: kind (the literal string "
    '"hypothesis"), id (lowercase-with-hyphens), version (semver, e.g. "0.1.0"), '
    "name, proposal (one sentence), proposedFormulaTeX (LaTeX), origin (the "
    'literal string "llm"), references (array of strings), and checks. Inside '
    'checks include a "dimensional" object with lhsLabel, lhsDims, rhsLabel, '
    "rhsDims, where each *Dims is an object whose KEYS are SINGLE axis letters "
    "from L, T, M, E, Q, Theta, N and whose VALUES are integer exponents. Do "
    'NOT write keys like "L^2" or "T^-2" — the power goes in the VALUE, so '
    '"L squared" is {"L": 2} and "per second squared" is {"T": -2}. A velocity '
    'is {"L": 1, "T": -1}; an energy is {"M": 1, "L": 2, "T": -2}; omit zero '
    "axes. Also include in the "
    'dimensional object an "expr" field (a plain-ASCII expression for the '
    'right-hand side, e.g. "(1/2)*m*v**2") and a "symbols" map from each symbol '
    "in expr to its dimension object, so the engine can derive the dimensions "
    "from the formula."
)

USER = (
    "Propose the kinetic energy of a non-relativistic particle of mass m moving "
    "at speed v. Energy has dimensions M·L^2·T^-2. Give the HypothesisCard."
)


def ask_model() -> str:
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER},
        ],
        "stream": False,
        "temperature": 0,
    }
    resp = httpx.post(f"{BASE_URL}/chat/completions", json=payload, headers=headers, timeout=120)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def extract_json(text: str) -> dict:
    """Pull the JSON object out of a model reply (tolerates ``` fences/prose)."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1]
        if text[:4].lower() == "json":
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    return json.loads(text)


def verify(raw: str) -> None:
    """Run the model's output through Lemma and print the verdict."""
    print("\n--- model output (verbatim) ---")
    print(raw)

    try:
        payload = extract_json(raw)
    except json.JSONDecodeError as exc:
        print(f"\nModel did not return valid JSON ({exc}). Nothing to verify — "
              "a proposal that isn't even a card is rejected at the door.")
        return

    try:
        card = parse_card(payload)
    except CardValidationError as exc:
        print(f"\nModel's card failed schema validation — {len(exc.issues)} issue(s):")
        for issue in exc.issues[:5]:
            print(f"  - {issue.path}  {issue.message}")
        return

    result = run_hypothesis_checks(card, corpus=CORPUS)
    overall = result.overall
    print("\n--- Lemma verdict on the model's proposal ---")
    print(f"  {card.id}: {overall.severity}  ({overall.passing}/{overall.total} checks pass)")
    for check in result.checks:
        print(f"    [{check.severity:>4}] {check.name}")
    print(f"  → {result.diagnosis}")


def main() -> None:
    print(f"Model:  {MODEL}   via   {BASE_URL}")
    print(f"Corpus: {len(CORPUS)} cards")
    try:
        raw = ask_model()
    except httpx.ConnectError:
        print(
            f"\nCould not reach a model at {BASE_URL}.\n"
            "  • Local Ollama:  run `ollama serve` and `ollama pull llama3.1:8b`\n"
            "  • Hosted endpoint:  set LEMMA_LLM_BASE_URL / LEMMA_LLM_API_KEY / LEMMA_LLM_MODEL",
            file=sys.stderr,
        )
        sys.exit(1)
    verify(raw)


if __name__ == "__main__":
    main()
