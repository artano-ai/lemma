# Python API reference

Auto-generated from docstrings on every public name in the
`artano_lemma` package. To see a symbol in context, click through to
its source on GitHub.

The four module groupings below mirror the package layout: types
and validation in [Types and validator](#types-and-validator), the
corpus loader and filtering helpers in [Cards](#cards), the
verification engine in [Engine](#engine), and the MCP client +
tool surface in [Tools, server, client](#tools-server-client).

---

## Types and validator

::: artano_lemma.types
    options:
      show_root_heading: false
      members:
        - Card
        - PrincipleCard
        - OpsCard
        - HypothesisCard
        - UnidentifiedCard
        - DimVec
        - HypothesisChecksSpec
        - DimensionalCheckSpec
        - LimitCheckSpec
        - ConservationLawSpec
        - ReferenceCorpusCheckSpec
        - DerivedFrom
        - OpsParameter
        - UsceCheck
        - EvaluateResult
        - EvaluateOverall
        - CheckSeverity
        - OverallSeverity
        - ConservationLaw
        - HypothesisOrigin
        - ValidationEnvelopeValue

::: artano_lemma.validator
    options:
      show_root_heading: false
      members:
        - validate_card_payload
        - is_valid_card_payload
        - parse_card
        - get_validator
        - CardValidationError
        - ValidationIssue

---

## Cards

::: artano_lemma.cards
    options:
      show_root_heading: false
      members:
        - load_cards
        - load_cards_with_failures
        - iter_cards
        - find_card
        - filter_cards
        - domains
        - cards_root
        - CardsLoadError
        - LoadFailure

---

## Engine

::: artano_lemma.engine
    options:
      show_root_heading: false
      members:
        - run_hypothesis_checks

::: artano_lemma.dimensional
    options:
      show_root_heading: false
      members:
        - dims_equal
        - stringify_dims
        - is_dimensionless
        - AXES

---

## Tools, server, client

The four tools the MCP server exposes are also importable as
plain Python functions — useful for in-process callers that don't
need the protocol overhead.

::: artano_lemma.tools
    options:
      show_root_heading: false
      members:
        - cards_list
        - cards_get
        - ops_get
        - hypothesis_crosscheck

::: artano_lemma.client
    options:
      show_root_heading: false
      members:
        - LemmaClient
        - LemmaToolError
        - connect_lemma_stdio
        - connect_lemma_session
