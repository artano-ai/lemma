# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Atomira Technologies, S.L.

"""Symbolic discharge of declared card claims — **opt-in, Python-only**.

A HypothesisCard may declare that in some regime its formula reduces to
something known: *"as b -> 0, this reduces to free-fall-uniform-gravity"*. The
v1 engine records that claim and returns ``warn`` — it confirms the claim is
well-formed and never tests it. This module tests it, with SymPy.

Five operations, because ``limits[]`` and ``conservationLaws[]`` each turned out
to hold several distinct things under one name:

* ``limit`` — a genuine limiting process, ``b -> 0``
* ``substitute`` — setting a variable, ``y = 0``; disagrees with a limit
  wherever the function is discontinuous at the point
* ``solveFor`` — a root: terminal velocity is the ``v`` where the net force
  vanishes, not the limit of the force expression
* ``fixedPoint`` — a stationary point of a *coupled system*, which cannot be
  found from one equation at all
* ``evolution`` — how a quantity changes along the dynamics. ``rate: "0"`` is
  genuine conservation; a non-zero rate is a dissipation claim, which is what
  both corpus cards carrying a conservation law actually assert.

Separating them is not pedantry: they give different answers, and a claim that
declares two of them is ambiguous rather than richer.

## Why it is off by default

Three reasons, and the first is the load-bearing one:

1. **It changes what a verdict means.** Every committed benchmark landmark and
   every published description of the engine was produced with these claims
   recorded, not discharged. Turning that on by default would silently
   re-baseline scores that papers already cite. Same argument that made
   ``require_checks`` opt-in.
2. **SymPy is an optional dependency.** ``pip install artano-lemma[symbolic]``.
   Absent, this module degrades to the recorded-claim behaviour rather than
   erroring.
3. **It is Python-only.** There is no comparable CAS in the Node ecosystem, so
   this is the first deliberate divergence between the two implementations. The
   cross-language parity fixture in ``lemma/parity/`` therefore excludes it: the
   fixture's cases never enable symbolic checks, so both engines stay
   byte-identical on everything the fixture covers. **If you extend this, do not
   let it leak into the default path** — that would break parity silently, which
   is the failure the fixture exists to prevent.

## The rule this module is built around

*Cannot check* and *checked, and it is wrong* must never share a code path. A
limit that will not evaluate, a target that will not resolve, or a difference
SymPy cannot simplify to zero all return ``warn`` — an unproven claim is not a
disproven one. Only a difference that simplifies to something demonstrably
non-zero returns ``fail``.

This is the same distinction ``InconsistentTermsError`` draws in
``dimensional.py``, and it is the one that is easy to get wrong here: SymPy
failing to simplify looks a lot like a mismatch if you are not careful.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .types import (
    Card,
    CheckSeverity,
    ConservationLawSpec,
    LimitCheckSpec,
    UsceCheck,
)

__all__ = [
    "SYMPY_AVAILABLE",
    "discharge_conservation",
    "discharge_limit",
    "symbolic_limit_checks",
]

try:  # pragma: no cover - import guard
    import sympy

    SYMPY_AVAILABLE = True
except ImportError:  # pragma: no cover - import guard
    sympy = None  # type: ignore[assignment]
    SYMPY_AVAILABLE = False


_LIMIT_POINTS: dict[str, Any] = {}


def _limit_point(raw: str) -> Any:
    """Parse a limit point: '0', 'oo', '-oo', or a numeric literal."""
    text = raw.strip()
    if text in ("oo", "+oo", "infinity", "inf"):
        return sympy.oo
    if text in ("-oo", "-infinity", "-inf"):
        return -sympy.oo
    return sympy.sympify(text)


def _formula_expr(card: Card) -> str | None:
    """The machine-readable expression a PrincipleCard declares, if any."""
    formula = getattr(card, "formula", None)
    if formula is None:
        return None
    expr = getattr(formula, "expr", None)
    if expr is None and isinstance(formula, dict):
        expr = formula.get("expr")
    return expr


def _symbol_names(obj: Any) -> list[str]:
    """Declared symbol names on a dimensional spec or a machine formula."""
    symbols = getattr(obj, "symbols", None)
    if symbols is None and isinstance(obj, dict):
        symbols = obj.get("symbols")
    return list(symbols) if isinstance(symbols, Mapping) else []


def discharge_limit(
    spec: LimitCheckSpec,
    parent_expr: str,
    *,
    corpus: Iterable[Card] = (),
    declared_symbols: Iterable[str] = (),
) -> UsceCheck:
    """Test one declared limit claim.

    ``parent_expr`` is the hypothesis's own formula (its
    ``checks.dimensional.expr``). The target comes from ``spec.target`` —
    either another card's ``formula.expr`` or an inline expression.

    ``declared_symbols`` are the names both sides declare. They are bound to
    plain symbols before parsing so SymPy cannot reinterpret a physics
    parameter as one of its own functions or constants — see the comment at
    the parse site, which is a silent-wrong-answer trap rather than a
    theoretical one.
    """
    name = f"Hypothesis.limit_{spec.name}"
    _declared_symbols = list(declared_symbols)

    def warn(detail: str) -> UsceCheck:
        return UsceCheck(name=name, severity="warn", detail=detail)

    if not SYMPY_AVAILABLE:
        return warn(
            f"Claim recorded: in the regime {spec.regime}, the proposal should reduce "
            f"to {spec.expectedReducesTo}. Symbolic verification unavailable — install "
            f"the 'symbolic' extra to discharge it."
        )

    limit = getattr(spec, "limit", None)
    substitute = getattr(spec, "substitute", None)
    solve_for = getattr(spec, "solveFor", None)
    fixed_point = getattr(spec, "fixedPoint", None)
    target = getattr(spec, "target", None)
    operations = [op for op in (limit, substitute, solve_for, fixed_point) if op]
    if not operations or target is None:
        return warn(
            f"Claim recorded: in the regime {spec.regime}, the proposal should reduce "
            f"to {spec.expectedReducesTo}. Not machine-checkable — the card declares no "
            f"machine form ('limit', 'substitute', 'solveFor' or 'fixedPoint') paired "
            f"with a 'target', so the regime and its target are prose."
        )
    if len(operations) > 1:
        return warn(
            f"Claim recorded: the spec declares more than one machine form, which is "
            f"ambiguous rather than richer — a limit, a substitution, a root and a "
            f"fixed point are different operations. Declare exactly one."
        )

    # A fixed point is checked against a whole tuple, so it takes its own path
    # rather than the single-expression comparison the other three share.
    if fixed_point is not None:
        return _discharge_fixed_point(
            spec, name, fixed_point, target, _declared_symbols, warn
        )

    # Resolve the target expression.
    target_card_id = getattr(target, "cardId", None)
    target_expr_raw = getattr(target, "expr", None)
    if target_card_id:
        match = next((c for c in corpus if getattr(c, "id", None) == target_card_id), None)
        if match is None:
            return warn(
                f"Claim recorded: target card \"{target_card_id}\" does not resolve in "
                f"the corpus, so the limit cannot be compared against it."
            )
        # The target declares its own symbols; bind those too, so a name that is
        # a SymPy function on either side of the comparison stays a variable.
        _declared_symbols += _symbol_names(getattr(match, "formula", None))
        target_expr_raw = _formula_expr(match)
        if not target_expr_raw:
            return warn(
                f"Claim recorded: target card \"{target_card_id}\" resolves but declares "
                f"no machine-readable 'formula', so there is nothing to reduce to. Add "
                f"formula.expr to that card to make this claim checkable."
            )

    try:
        # Bind every declared name to a plain Symbol before parsing. Without this
        # SymPy resolves bare names against its own namespace, where `beta`,
        # `gamma`, `zeta` and `lambda` are special FUNCTIONS and `pi`, `E`, `I`,
        # `N`, `S`, `O`, `Q` are constants or helpers. `beta*x*y` then raises
        # (FunctionClass * Symbol), and `pi*r**2` is worse — it parses cleanly as
        # 3.14159..., silently computing a different expression than the card
        # declared. Greek letters are exactly what a physics card names its
        # parameters, so this is the common case, not an edge case.
        local = {name: sympy.Symbol(name) for name in _declared_symbols}
        child = sympy.sympify(parent_expr, locals=local)
        goal = sympy.sympify(target_expr_raw, locals=local)

        if limit is not None:
            operation = f"as {limit.symbol} -> {limit.to}"
            sym = local.setdefault(limit.symbol, sympy.Symbol(limit.symbol))
            taken = sympy.limit(child, sym, _limit_point(limit.to))
        elif substitute is not None:
            pairs = {
                local.setdefault(k, sympy.Symbol(k)): sympy.sympify(v, locals=local)
                for k, v in substitute.items()
            }
            operation = "with " + ", ".join(f"{k} = {v}" for k, v in substitute.items())
            taken = sympy.simplify(child.subs(pairs))
        else:
            sym = local.setdefault(solve_for.symbol, sympy.Symbol(solve_for.symbol))
            operation = f"solving for {solve_for.symbol} where the expression vanishes"
            roots = sympy.solve(sympy.Eq(child, 0), sym)
            if not roots:
                return warn(
                    f"Claim recorded: no root for {solve_for.symbol} was found, so the "
                    f"claim is neither proven nor disproven."
                )
            # A single root compares directly. Several means the claim is only
            # meaningful if the declared target is one of them — report which.
            if len(roots) > 1:
                if any(sympy.simplify(r - goal).equals(0) for r in roots):
                    return UsceCheck(
                        name=name,
                        severity="pass",
                        detail=(
                            f"Discharged symbolically: {operation}, {parent_expr} has "
                            f"roots {', '.join(sympy.sstr(r) for r in roots)}, one of "
                            f"which is the declared target {sympy.sstr(goal)}."
                        ),
                    )
                return UsceCheck(
                    name=name,
                    severity="fail",
                    detail=(
                        f"Root claim refuted: {operation}, {parent_expr} has roots "
                        f"{', '.join(sympy.sstr(r) for r in roots)}, none of which is "
                        f"the declared target {sympy.sstr(goal)}."
                    ),
                )
            taken = roots[0]
        # `.equals()` is the three-valued test this check needs: True, False, or
        # None when SymPy cannot decide. `simplify(a - b) == 0` only distinguishes
        # "provably equal" from "everything else", which lumps a real refutation
        # together with an incomplete simplification.
        verdict = sympy.simplify(taken - goal).equals(0)
    except Exception as exc:  # noqa: BLE001 - any CAS failure is "cannot check"
        return warn(
            f"Claim recorded: symbolic evaluation did not complete "
            f"({type(exc).__name__}: {exc}), so the claim is neither proven nor "
            f"disproven."
        )

    if verdict is True:
        return UsceCheck(
            name=name,
            severity="pass",
            detail=(
                f"Discharged symbolically: {operation}, {parent_expr} reduces to "
                f"{sympy.sstr(taken)}, which equals the declared target "
                f"{sympy.sstr(goal)}."
            ),
        )

    if verdict is False:
        return UsceCheck(
            name=name,
            severity="fail",
            detail=(
                f"Claim refuted: {operation}, {parent_expr} reduces to "
                f"{sympy.sstr(taken)}, but the card declares it reduces to "
                f"{sympy.sstr(goal)}. These are not the same expression."
            ),
        )

    # `None` — SymPy could not decide. That is an inability, not a counterexample,
    # and reporting it as a refuted claim would be a fabricated verdict.
    return warn(
        f"Claim recorded: the limit evaluated to {sympy.sstr(taken)}, but SymPy could "
        f"not decide whether it equals the declared target {sympy.sstr(goal)}. Neither "
        f"proven nor refuted — an undecided comparison, not a counterexample."
    )


def _discharge_fixed_point(spec, name, fixed_point, target, declared_symbols, warn):
    """Verify a declared stationary point of a coupled system.

    **By substitution, not by solving.** ``sympy.solve`` is not guaranteed to
    return a complete solution set, so "the declared point is not among the
    roots solve found" is not evidence that it is not a fixed point — treating
    it as a refutation would fabricate a verdict out of a CAS limitation. Every
    equation is instead evaluated *at* the declared point: if all of them vanish
    the point is stationary, and that is exactly what the claim asserts.

    The trade-off is honest and worth stating in the verdict: this proves the
    declared point **is** a fixed point, not that it is the **only** one in the
    regime. Uniqueness would need the completeness that was just refused.
    """
    point = getattr(target, "point", None)
    if not point:
        return warn(
            f"Claim recorded: a fixed point is a tuple of values, so it needs a "
            f"'target.point' mapping each solved-for symbol to its expression. The "
            f"card declares a 'fixedPoint' operation with a single-expression target "
            f"instead, and the two do not compare."
        )

    missing = [s for s in fixed_point.solveFor if s not in point]
    if missing:
        return warn(
            f"Claim recorded: the fixed point is solved for "
            f"{', '.join(fixed_point.solveFor)} but 'target.point' declares no value "
            f"for {', '.join(missing)}, so the claim is incomplete rather than wrong."
        )

    names = (
        list(declared_symbols)
        + list(fixed_point.solveFor)
        + list(fixed_point.parameters)
        + list(point)
    )
    try:
        local = {n: sympy.Symbol(n) for n in names}
        substitution = {
            local[sym]: sympy.sympify(expr, locals=local) for sym, expr in point.items()
        }
        residuals = []
        for equation in fixed_point.system:
            expr = sympy.sympify(equation.expr, locals=local)
            residuals.append((equation.of, sympy.simplify(expr.subs(substitution))))
    except Exception as exc:  # noqa: BLE001 - any CAS failure is "cannot check"
        return warn(
            f"Claim recorded: symbolic evaluation did not complete "
            f"({type(exc).__name__}: {exc}), so the claim is neither proven nor "
            f"disproven."
        )

    rendered = ", ".join(
        f"{sym} = {sympy.sstr(expr)}" for sym, expr in point.items()
    )

    # Same three-valued discipline as the single-expression path: only a residual
    # that is demonstrably non-zero refutes the claim.
    for (of, residual) in residuals:
        if residual.equals(0) is False:
            return UsceCheck(
                name=name,
                severity="fail",
                detail=(
                    f"Fixed-point claim refuted: at the declared point ({rendered}), "
                    f"the equation governing {of} evaluates to "
                    f"{sympy.sstr(residual)} rather than 0, so the system is not "
                    f"stationary there."
                ),
            )

    undecided = [
        (of, residual) for of, residual in residuals if residual.equals(0) is not True
    ]
    if undecided:
        of, residual = undecided[0]
        return warn(
            f"Claim recorded: at the declared point ({rendered}), SymPy could not "
            f"decide whether the equation governing {of} vanishes — it simplified to "
            f"{sympy.sstr(residual)}. Neither proven nor refuted."
        )

    # The point is stationary. That alone does not identify WHICH stationary point
    # it is: a predator-prey system is equally stationary at extinction, so a card
    # claiming coexistence would otherwise pass while declaring (0, 0). The
    # declared conditions are what separate the branches.
    unverified: list[str] = []
    for condition in fixed_point.conditions:
        try:
            held = sympy.simplify(
                sympy.sympify(condition, locals=local).subs(substitution)
            )
        except Exception:  # noqa: BLE001 - an unparseable condition is not a refutation
            unverified.append(condition)
            continue
        if held is sympy.false:
            return UsceCheck(
                name=name,
                severity="fail",
                detail=(
                    f"Fixed-point claim refuted: ({rendered}) is stationary, but it is "
                    f"the wrong stationary point — the claim requires {condition}, "
                    f"which is false there. A coupled system has several fixed points "
                    f"and this is not the one claimed."
                ),
            )
        if held is not sympy.true:
            unverified.append(condition)

    governed = ", ".join(of for of, _ in residuals)
    detail = (
        f"Discharged symbolically: at ({rendered}) every equation of the system "
        f"vanishes ({governed}), so the declared point is stationary. This proves "
        f"the point is a fixed point, not that it is the only one in the regime."
    )
    if unverified:
        # Deliberately still a pass: stationarity WAS proven. Conditions like
        # `y > 0` need sign assumptions on the parameters that no card declares,
        # so they are undecidable rather than false — and an undecidable side
        # condition must not retract a verdict that was actually established.
        detail += (
            f" Not verified: {', '.join(unverified)} — undecidable without sign "
            f"assumptions on the parameters, so the branch is asserted rather than "
            f"proven."
        )
    return UsceCheck(name=name, severity="pass", detail=detail)


def discharge_conservation(
    spec: ConservationLawSpec,
    *,
    declared_symbols: Iterable[str] = (),
) -> UsceCheck:
    """Test one declared conservation or dissipation claim.

    Differentiates the declared quantity along the declared dynamics and
    compares against the claimed rate. ``rate: "0"`` is genuine conservation;
    everything else is a dissipation claim, which is what both corpus cards
    carrying a conservation law actually assert.

    The three-valued discipline is the same as everywhere else in this module:
    only a difference SymPy shows to be non-zero refutes the claim.
    """
    name = f"Hypothesis.conservation_{spec.law}"

    def warn(detail: str) -> UsceCheck:
        return UsceCheck(name=name, severity="warn", detail=detail)

    recorded = (
        f"Claim recorded: {spec.law} conservation — {spec.statement}. "
        f"Symbolic / numeric verification pending."
    )
    if not SYMPY_AVAILABLE:
        return warn(recorded)

    evolution = getattr(spec, "evolution", None)
    if evolution is None:
        return warn(
            f"Claim recorded: {spec.law} conservation — {spec.statement}. Not "
            f"machine-checkable — the card declares no 'evolution' block, so the "
            f"quantity, the dynamics it evolves under, and its claimed rate are all "
            f"prose."
        )

    state = [equation.of for equation in evolution.system]
    names = list(declared_symbols) + list(evolution.parameters) + state
    try:
        time = sympy.Symbol("_t")
        local = {n: sympy.Symbol(n) for n in names}
        # Differentiate along the trajectory: promote each state variable to a
        # function of time, apply the chain rule, then substitute the declared
        # derivatives back in. This is what makes the check about the *system*
        # rather than about the quantity's shape in isolation.
        functions = {local[s]: sympy.Function(s)(time) for s in state}
        derivatives = {
            sympy.diff(functions[local[s.of]], time): sympy.sympify(
                s.expr, locals=local
            ).subs(functions)
            for s in evolution.system
        }
        quantity = sympy.sympify(evolution.quantity, locals=local).subs(functions)
        computed = sympy.simplify(
            sympy.diff(quantity, time).subs(derivatives).subs(
                {v: k for k, v in functions.items()}
            )
        )
        claimed = sympy.sympify(evolution.rate, locals=local)
        verdict = sympy.simplify(computed - claimed).equals(0)
    except Exception as exc:  # noqa: BLE001 - any CAS failure is "cannot check"
        return warn(
            f"Claim recorded: symbolic evaluation did not complete "
            f"({type(exc).__name__}: {exc}), so the claim is neither proven nor "
            f"disproven."
        )

    conserved = claimed == 0
    label = "is conserved" if conserved else f"evolves at {sympy.sstr(claimed)}"
    if verdict is True:
        return UsceCheck(
            name=name,
            severity="pass",
            detail=(
                f"Discharged symbolically: differentiating {evolution.quantity} along "
                f"the declared dynamics gives {sympy.sstr(computed)}, so the quantity "
                f"{label} exactly as claimed."
            ),
        )
    if verdict is False:
        return UsceCheck(
            name=name,
            severity="fail",
            detail=(
                f"Claim refuted: differentiating {evolution.quantity} along the "
                f"declared dynamics gives {sympy.sstr(computed)}, but the card claims "
                f"{sympy.sstr(claimed)}. These are not the same expression, so the "
                f"stated rate does not follow from the stated dynamics."
            ),
        )
    return warn(
        f"Claim recorded: the derivative evaluated to {sympy.sstr(computed)}, but "
        f"SymPy could not decide whether it equals the claimed {sympy.sstr(claimed)}. "
        f"Neither proven nor refuted — an undecided comparison, not a counterexample."
    )


def symbolic_limit_checks(
    limits: Iterable[LimitCheckSpec],
    parent_expr: str | None,
    *,
    corpus: Iterable[Card] = (),
    declared_symbols: Iterable[str] = (),
) -> list[UsceCheck]:
    """Discharge every limit claim that carries a machine-readable spec."""
    corpus = list(corpus)
    declared_symbols = list(declared_symbols)
    out: list[UsceCheck] = []
    for spec in limits:
        if not parent_expr:
            out.append(
                UsceCheck(
                    name=f"Hypothesis.limit_{spec.name}",
                    severity="warn",
                    detail=(
                        f"Claim recorded: in the regime {spec.regime}, the proposal "
                        f"should reduce to {spec.expectedReducesTo}. The hypothesis "
                        f"declares no checks.dimensional.expr, so its own formula is "
                        f"not machine-readable either."
                    ),
                )
            )
            continue
        out.append(
            discharge_limit(
                spec, parent_expr, corpus=corpus, declared_symbols=declared_symbols
            )
        )
    return out
