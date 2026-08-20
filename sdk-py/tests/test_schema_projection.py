# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""The Pydantic models are a projection of the JSON Schema — keep them one.

The schema is the authority for what a card may contain. These models are a
hand-maintained mirror of it, and the TypeScript types in
``mcp-server/src/cards/types.ts`` are a third copy of the same facts. Three
representations of one contract drift, and the drift is **silent**: a field
missing from a model does not raise, it just quietly stops round-tripping.

That is not hypothetical. Six fields — every machine form on ``limits[]``, plus
``formula`` and ``evolution`` — reached the schema and these models but never
reached TypeScript, and nothing noticed, because TypeScript types are erased at
runtime so both engines kept emitting identical JSON while the type definitions
diverged.

The TypeScript half of this guard lives in ``scripts/check-corpus.mjs`` (it runs
in the ``cards`` CI job, which installs no dependencies). This file guards the
Python half.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from artano_lemma import types as T

SCHEMA = json.loads(
    (pathlib.Path(__file__).resolve().parents[2] / "schema" / "card.v0.1.json").read_text()
)

# (schema $defs name, pydantic model)
PROJECTIONS = [
    ("PrincipleCard", T.PrincipleCard),
    ("OpsCard", T.OpsCard),
    ("HypothesisCard", T.HypothesisCard),
    ("HypothesisChecksSpec", T.HypothesisChecksSpec),
    ("MachineFormula", T.MachineFormula),
    ("UnidentifiedCard", T.UnidentifiedCard),
]


@pytest.mark.parametrize("def_name,model", PROJECTIONS, ids=[p[0] for p in PROJECTIONS])
def test_every_schema_field_exists_on_the_model(def_name, model):
    schema_fields = set(SCHEMA["$defs"][def_name]["properties"])
    missing = schema_fields - set(model.model_fields)
    assert not missing, (
        f"{model.__name__} is missing {sorted(missing)}, which the schema defines on "
        f"{def_name}. Pydantic is configured with extra='forbid', so a card using one "
        f"of these fails to parse rather than round-tripping."
    )


@pytest.mark.parametrize("def_name,model", PROJECTIONS, ids=[p[0] for p in PROJECTIONS])
def test_the_model_invents_no_field_the_schema_lacks(def_name, model):
    schema_fields = set(SCHEMA["$defs"][def_name]["properties"])
    extra = set(model.model_fields) - schema_fields
    assert not extra, (
        f"{model.__name__} declares {sorted(extra)}, which the schema does not define on "
        f"{def_name}. A model-only field is one a card can never legally carry — it will "
        f"validate here and fail ajv."
    )


# The check specs are defined inline under HypothesisChecksSpec rather than in
# $defs, so they are compared separately.

NESTED = [
    ("dimensional", T.DimensionalCheckSpec),
    ("limits", T.LimitCheckSpec),
    ("conservationLaws", T.ConservationLawSpec),
    ("referenceCorpus", T.ReferenceCorpusCheckSpec),
]


@pytest.mark.parametrize("key,model", NESTED, ids=[n[0] for n in NESTED])
def test_nested_check_specs_match_the_schema(key, model):
    node = SCHEMA["$defs"]["HypothesisChecksSpec"]["properties"][key]
    props = node.get("properties") or node.get("items", {}).get("properties")
    assert props, f"the schema defines no properties for checks.{key}; this test needs updating"
    missing = set(props) - set(model.model_fields)
    assert not missing, (
        f"{model.__name__} is missing {sorted(missing)}, which the schema defines on "
        f"checks.{key}."
    )


def test_extra_fields_are_forbidden_so_drift_cannot_pass_silently():
    """The guards above only matter because the models reject unknown fields.

    With ``extra='allow'`` a card carrying a field the model does not know would
    parse fine and silently lose it on the way out — the exact silent-drift
    failure this file exists to prevent.
    """
    for _, model in PROJECTIONS:
        assert model.model_config.get("extra") == "forbid", (
            f"{model.__name__} does not forbid extra fields; schema drift would pass silently"
        )
