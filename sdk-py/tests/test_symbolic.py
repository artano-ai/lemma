# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Symbolic discharge of limit claims — opt-in, Python-only.

The verdict boundary is the whole point of these tests. A limit check has three
outcomes, not two, and collapsing them is the failure mode:

* **pass** — the limit was taken and equals the declared target
* **fail** — the limit was taken and is *demonstrably* a different expression
* **warn** — it could not be evaluated, or SymPy could not decide

Reporting an undecided comparison as a refutation would be a fabricated verdict,
which is the same defect fixed in ``dimensional.py`` on 2026-08-17: *cannot
check* and *checked, and it is wrong* must never share a code path.
"""

from __future__ import annotations

import copy
import json
import pathlib

import pytest

from artano_lemma import HypothesisCard, run_hypothesis_checks
from artano_lemma.symbolic import SYMPY_AVAILABLE

pytestmark = pytest.mark.skipif(not SYMPY_AVAILABLE, reason="sympy not installed")

CARDS = pathlib.Path(__file__).resolve().parents[2] / "cards"
DRAG = json.loads((CARDS / "hypotheses" / "free-fall-with-linear-drag.json").read_text())
PARENT = json.loads(
    (CARDS / "physics" / "classical-mechanics" / "free-fall-uniform-gravity.json").read_text()
)
LV = json.loads(
    (CARDS / "hypotheses" / "lotka-volterra-with-logistic-prey.json").read_text()
)
LV_PARENT = json.loads(
    (CARDS / "biology" / "population-dynamics" / "lotka-volterra-predator-prey.json").read_text()
)


def _corpus():
    from artano_lemma.types import PrincipleCard

    return [PrincipleCard(**PARENT)]


def _limit_check(mutate=None, *, symbolic=True):
    payload = copy.deepcopy(DRAG)
    if mutate:
        mutate(payload)
    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=_corpus(), symbolic=symbolic
    )
    return next(c for c in result.checks if c.name.startswith("Hypothesis.limit_drag"))


# --- the default must not change -------------------------------------------
# Every committed landmark and every published description of this engine was
# produced with limit claims recorded, not discharged.


def test_default_is_off_and_still_merely_records_the_claim():
    check = _limit_check(symbolic=False)
    assert check.severity == "warn"
    assert "Claim recorded" in check.detail
    assert "Discharged" not in check.detail


# --- pass / fail -------------------------------------------------------------


def test_a_true_limit_claim_is_discharged():
    check = _limit_check()
    assert check.severity == "pass"
    assert "Discharged symbolically" in check.detail


def test_a_false_limit_claim_is_refuted():
    def wrong_target(payload):
        payload["checks"]["limits"][0]["target"] = {"expr": "-m*g/2"}

    check = _limit_check(wrong_target)
    assert check.severity == "fail"
    assert "refuted" in check.detail


def test_a_limit_that_does_not_actually_reduce_is_refuted():
    """Taking the limit over a symbol the expression does not contain leaves it
    unchanged, so it does not reach the target. A nonsense limit spec must be
    refused rather than waved through."""

    def absent_symbol(payload):
        payload["checks"]["limits"][0]["limit"]["symbol"] = "zzz"

    assert _limit_check(absent_symbol).severity == "fail"


# --- everything that cannot be checked must warn, never fail -----------------


def test_unresolvable_target_card_warns():
    def missing(payload):
        payload["checks"]["limits"][0]["target"] = {"cardId": "no-such-card"}

    check = _limit_check(missing)
    assert check.severity == "warn"
    assert "does not resolve" in check.detail


def test_target_card_without_a_machine_formula_warns_and_says_why():
    def target_without_formula(payload):
        payload["checks"]["limits"][0]["target"] = {"cardId": "bare-card"}

    payload = copy.deepcopy(DRAG)
    target_without_formula(payload)
    bare = {k: v for k, v in PARENT.items() if k != "formula"}
    bare["id"] = "bare-card"
    from artano_lemma.types import PrincipleCard

    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=[PrincipleCard(**bare)], symbolic=True
    )
    check = next(c for c in result.checks if c.name.startswith("Hypothesis.limit_drag"))
    assert check.severity == "warn"
    assert "formula" in check.detail


def test_claim_without_a_machine_limit_spec_warns():
    def drop_spec(payload):
        payload["checks"]["limits"][0].pop("limit")

    check = _limit_check(drop_spec)
    assert check.severity == "warn"
    assert "not machine-checkable" in check.detail.lower()


def test_hypothesis_without_its_own_expr_warns():
    def drop_expr(payload):
        payload["checks"]["dimensional"].pop("expr")

    check = _limit_check(drop_expr)
    assert check.severity == "warn"


# --- the three operations are not interchangeable ----------------------------
# `limits[]` historically held a limit, a substitution and a root under one name.
# They are separated because they give different answers: a substitution and a
# limit disagree wherever the function is discontinuous at the point, and a root
# is not a limit at all.


def test_substitution_is_discharged():
    """`y = 0` sets the predator population — a substitution, not a limit."""
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="no_predators",
        regime="y = 0",
        expectedReducesTo="logistic prey growth",
        substitute={"y": "0"},
        target={"expr": "alpha*x*(1 - x/K)"},
    )
    check = discharge_limit(
        spec,
        "alpha*x*(1 - x/K) - beta*x*y",
        declared_symbols=["alpha", "beta", "x", "y", "K"],
    )
    assert check.severity == "pass", check.detail
    assert "with y = 0" in check.detail


def test_root_is_discharged():
    """Terminal velocity is the v where the net force vanishes — a root of
    expr = 0, not the limit of the force expression as t -> infinity."""
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="terminal_velocity",
        regime="t -> infinity",
        expectedReducesTo="v -> -m g / b",
        solveFor={"symbol": "v"},
        target={"expr": "-m*g/b"},
    )
    check = discharge_limit(
        spec, "-m*g - b*v", declared_symbols=["m", "g", "b", "v"]
    )
    assert check.severity == "pass", check.detail
    assert "solving for v" in check.detail


def test_a_wrong_root_is_refuted():
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="t",
        regime="steady state",
        expectedReducesTo="wrong",
        solveFor={"symbol": "v"},
        target={"expr": "-m*g/(2*b)"},
    )
    check = discharge_limit(
        spec, "-m*g - b*v", declared_symbols=["m", "g", "b", "v"]
    )
    assert check.severity == "fail", check.detail


def test_declaring_two_machine_forms_is_ambiguous_not_richer():
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="t",
        regime="both",
        expectedReducesTo="x",
        limit={"symbol": "b", "to": "0"},
        substitute={"b": "0"},
        target={"expr": "-m*g"},
    )
    check = discharge_limit(
        spec, "-m*g - b*v", declared_symbols=["m", "g", "b", "v"]
    )
    assert check.severity == "warn"
    assert "ambiguous" in check.detail


# --- SymPy namespace collisions ---------------------------------------------
# The trap: bare `sympify` resolves names against SymPy's own namespace, where
# `beta`, `gamma`, `zeta` and `lambda` are special FUNCTIONS and `pi`, `E`, `I`,
# `N`, `S` are constants. Greek letters are exactly what a physics card names its
# parameters. `beta*x*y` raises outright; `pi*r**2` is worse — it parses cleanly
# as 3.14159..., silently computing a different expression than the card declared.
# Declared symbols are therefore bound explicitly before parsing.


def test_sympy_function_names_are_treated_as_variables():
    """`beta` is SymPy's beta function. A card using it as a parameter must
    still work — this is the common case for physics cards, not an edge case."""
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="t",
        regime="K -> oo",
        expectedReducesTo="alpha*x - beta*x*y",
        limit={"symbol": "K", "to": "oo"},
        target={"expr": "alpha*x - beta*x*y"},
    )
    check = discharge_limit(
        spec,
        "alpha*x*(1 - x/K) - beta*x*y",
        declared_symbols=["alpha", "beta", "x", "y", "K"],
    )
    assert check.severity == "pass", check.detail


def test_sympy_constant_names_are_treated_as_variables():
    """`pi` and `E` parse silently as constants if not bound — the dangerous
    case, because nothing raises and the wrong expression is compared."""
    from artano_lemma.symbolic import discharge_limit
    from artano_lemma.types import LimitCheckSpec

    spec = LimitCheckSpec(
        name="t",
        regime="q -> 0",
        expectedReducesTo="pi*E",
        limit={"symbol": "q", "to": "0"},
        target={"expr": "pi*E"},
    )
    # If pi and E bound to SymPy's constants, `pi*E + q` -> 8.539... and the
    # comparison would still pass by coincidence; binding them as symbols keeps
    # the check about the card's actual variables.
    check = discharge_limit(
        spec, "pi*E + q", declared_symbols=["pi", "E", "q"]
    )
    assert check.severity == "pass", check.detail
    assert "pi*E" in check.detail


# --- the corpus claim this was built for ------------------------------------


def test_the_real_corpus_claim_discharges():
    """`free-fall-with-linear-drag` declares that as b -> 0 it reduces to
    `free-fall-uniform-gravity`. That is the first claim in the corpus with a
    machine-readable limit and target, and it is genuinely true:
    -m*g - b*v  ->  -m*g."""
    check = _limit_check()
    assert check.severity == "pass"
    assert "b -> 0" in check.detail


# --- fixed points of a coupled system ----------------------------------------
# The fourth operation, and the one that needed a system rather than a single
# expression. Verified by SUBSTITUTION, not by solving: `sympy.solve` is not
# guaranteed complete, so "not among the roots solve returned" is a CAS
# limitation and not evidence against the claim.


def _lv(mutate=None):
    payload = copy.deepcopy(LV)
    spec = next(
        limit
        for limit in payload["checks"]["limits"]
        if limit["name"] == "coexistence_equilibrium"
    )
    if mutate:
        mutate(spec)
    from artano_lemma.types import PrincipleCard

    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=[PrincipleCard(**LV_PARENT)], symbolic=True
    )
    return next(
        c for c in result.checks if c.name == "Hypothesis.limit_coexistence_equilibrium"
    )


def test_the_coexistence_fixed_point_discharges():
    """The claim that needed a coupled system: the interior equilibrium of
    logistic-prey Lotka-Volterra. It cannot be checked from the prey equation
    alone, which is why the system is declared on the spec."""
    check = _lv()
    assert check.severity == "pass", check.detail
    assert "every equation of the system vanishes" in check.detail


def test_stationarity_alone_is_not_enough_to_identify_the_branch():
    """Extinction (0, 0) IS stationary, so substitution alone would accept it for
    a claim about coexistence. The declared conditions are what separate the
    branches — without them this check would pass a card declaring the wrong
    fixed point."""
    for point in ({"x": "0", "y": "0"}, {"x": "K", "y": "0"}):
        check = _lv(lambda s: s["target"].__setitem__("point", point))
        assert check.severity == "fail", check.detail
        assert "wrong stationary point" in check.detail


def test_a_point_that_is_not_stationary_is_refuted():
    check = _lv(lambda s: s["target"]["point"].__setitem__("x", "2*gamma/delta"))
    assert check.severity == "fail", check.detail
    assert "not stationary" in check.detail


def test_an_undecidable_condition_does_not_retract_a_proven_verdict():
    """`y > 0` needs sign assumptions on the parameters that no card declares, so
    it is undecidable rather than false. Stationarity WAS proven; an undecidable
    side condition must not turn that into a warn — it is reported instead."""
    check = _lv()
    assert check.severity == "pass"
    assert "Not verified: y > 0" in check.detail
    assert "asserted rather than proven" in check.detail


def test_a_scalar_target_does_not_compare_against_a_tuple():
    def scalar(spec):
        spec["target"].pop("point")
        spec["target"]["expr"] = "gamma/delta"

    check = _lv(scalar)
    assert check.severity == "warn"
    assert "tuple of values" in check.detail


def test_an_incomplete_point_is_incomplete_not_wrong():
    check = _lv(lambda s: s["target"]["point"].pop("y"))
    assert check.severity == "warn"
    assert "incomplete rather than wrong" in check.detail


def test_system_parameters_must_be_declared_not_guessed():
    """The system introduces `gamma` and `delta`, which the hypothesis's own
    symbol list does not carry — and `gamma` is SymPy's gamma function. Dropping
    the declaration must degrade to a warn, never to a fabricated verdict."""
    check = _lv(lambda s: s["fixedPoint"].__setitem__("parameters", []))
    assert check.severity == "warn"
    assert "did not complete" in check.detail


def test_declaring_a_fixed_point_alongside_another_form_is_ambiguous():
    check = _lv(lambda s: s.__setitem__("limit", {"symbol": "K", "to": "oo"}))
    assert check.severity == "warn"
    assert "ambiguous" in check.detail


# --- conservation, which is really dissipation -------------------------------
# Both corpus cards carrying a conservation law assert that a quantity is NOT
# conserved, at a specific rate. A checker that only tested "does the derivative
# vanish" would have covered neither, so the check compares against a declared
# rate and treats `rate: "0"` as the conserved special case.


def _conservation(card, parent, mutate=None):
    payload = copy.deepcopy(card)
    if mutate:
        mutate(payload["checks"]["conservationLaws"][0]["evolution"])
    from artano_lemma.types import PrincipleCard

    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=[PrincipleCard(**parent)], symbolic=True
    )
    return next(c for c in result.checks if "conservation" in c.name)


def test_energy_dissipation_under_drag_discharges():
    """dE/dt = -b v^2: differentiate total mechanical energy along the dynamics."""
    check = _conservation(DRAG, PARENT)
    assert check.severity == "pass", check.detail
    assert "-b*v**2" in check.detail


def test_the_lyapunov_rate_discharges():
    check = _conservation(LV, LV_PARENT)
    assert check.severity == "pass", check.detail


def test_it_refutes_the_defect_this_check_was_built_to_find():
    """The card originally declared the CLASSICAL Volterra invariant and a rate
    missing a factor of delta. The classical invariant is not a Lyapunov function
    for the logistic system — its rate is positive for x < x*, so the card
    asserted asymptotic stability from an expression that does not show it. This
    is the regression guard for that defect."""

    def as_originally_written(evolution):
        evolution["quantity"] = "delta*x - gamma*log(x) + beta*y - alpha*log(y)"
        evolution["rate"] = "-(alpha/K)*(x - gamma/delta)**2"

    check = _conservation(LV, LV_PARENT, as_originally_written)
    assert check.severity == "fail", check.detail
    assert "does not follow from the stated dynamics" in check.detail


def test_a_rate_off_by_a_factor_is_refuted():
    """The subtler half of the same defect, isolated: right quantity, wrong
    coefficient. A check that only compared shapes would miss this."""
    check = _conservation(
        LV, LV_PARENT, lambda e: e.__setitem__("rate", "-(alpha/K)*(x - gamma/delta)**2")
    )
    assert check.severity == "fail"


def test_the_verdict_depends_on_the_declared_dynamics():
    """Swapping in the classical prey equation changes the answer, which is what
    makes this a check on the *system* rather than on the quantity in isolation."""
    check = _conservation(
        LV, LV_PARENT, lambda e: e["system"][0].__setitem__("expr", "alpha*x - beta*x*y")
    )
    assert check.severity == "fail"


def test_conservation_without_a_machine_form_still_merely_records():
    def drop(payload):
        payload["checks"]["conservationLaws"][0].pop("evolution")

    payload = copy.deepcopy(DRAG)
    drop(payload)
    from artano_lemma.types import PrincipleCard

    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=[PrincipleCard(**PARENT)], symbolic=True
    )
    check = next(c for c in result.checks if "conservation" in c.name)
    assert check.severity == "warn"
    assert "no 'evolution' block" in check.detail


def test_conservation_parameters_must_be_declared_not_guessed():
    check = _conservation(LV, LV_PARENT, lambda e: e.__setitem__("parameters", []))
    assert check.severity == "warn"
    assert "did not complete" in check.detail


def test_a_non_physics_law_name_is_accepted():
    """`law` was a closed six-value physics vocabulary, and it forced this exact
    card to declare `law="energy"` for a Lyapunov function while its own
    statement said "No conserved energy-like quantity." A type that makes a card
    mislabel itself is the domain-agnostic rule failing in the type system rather
    than in the engine. It is free-form now; this pins that."""
    check = _conservation(LV, LV_PARENT)
    assert check.severity == "pass", check.detail

    payload = copy.deepcopy(LV)
    assert payload["checks"]["conservationLaws"][0]["law"] == "lyapunov-function"

    from artano_lemma.types import PrincipleCard

    payload["checks"]["conservationLaws"][0]["law"] = "biomass"
    result = run_hypothesis_checks(
        HypothesisCard(**payload), corpus=[PrincipleCard(**LV_PARENT)], symbolic=True
    )
    named = next(c for c in result.checks if "conservation" in c.name)
    assert named.name == "Hypothesis.conservation_biomass"
    assert named.severity == "pass"


def test_a_genuinely_conserved_quantity_reads_as_conserved():
    """`rate: "0"` is the conserved special case, and the prose must say so
    rather than reporting that it "evolves at 0"."""
    from artano_lemma.symbolic import discharge_conservation
    from artano_lemma.types import ConservationLawSpec

    spec = ConservationLawSpec(
        law="energy",
        statement="Undamped harmonic oscillator: total energy is conserved.",
        evolution={
            "quantity": "m*v**2/2 + k*x**2/2",
            "system": [{"of": "x", "expr": "v"}, {"of": "v", "expr": "-k*x/m"}],
            "rate": "0",
            "parameters": ["m", "k", "x", "v"],
        },
    )
    check = discharge_conservation(spec)
    assert check.severity == "pass", check.detail
    assert "is conserved" in check.detail


def test_the_second_corpus_claim_discharges():
    """`lotka-volterra-with-logistic-prey` declares that as K -> infinity the
    logistic correction vanishes and it reduces to the classical predator-prey
    card. Uses `beta` as a parameter, so it also exercises the SymPy-namespace
    binding above against real corpus data."""
    lv = json.loads(
        (CARDS / "hypotheses" / "lotka-volterra-with-logistic-prey.json").read_text()
    )
    parent = json.loads(
        (CARDS / "biology" / "population-dynamics" / "lotka-volterra-predator-prey.json").read_text()
    )
    from artano_lemma.types import PrincipleCard

    result = run_hypothesis_checks(
        HypothesisCard(**lv), corpus=[PrincipleCard(**parent)], symbolic=True
    )
    check = next(
        c for c in result.checks if c.name == "Hypothesis.limit_infinite_carrying_capacity"
    )
    assert check.severity == "pass", check.detail
    assert "K -> oo" in check.detail
