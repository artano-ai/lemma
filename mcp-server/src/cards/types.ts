// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Minimal card schema types for the MCP server, covering the fragment
 * the cards.* and hypothesis.* tools need. The canonical schema lives in
 * `schema/card.v0.1.json`; this file is a hand-typed projection of it.
 */

export interface Author {
  name: string;
  orcid?: string;
  github?: string;
  role?: 'author' | 'curator' | 'reviewer' | 'translator' | 'maintainer';
}

export interface CardMetadata {
  authors: Author[];
  tier?: 'bronze' | 'silver' | 'gold';
  created?: string;
  updated?: string;
}

/**
 * How closely independent methods must agree on one observable.
 *
 * Distinct from a validation envelope: an envelope bounds *one* run's value
 * absolutely, this bounds the *spread between* runs. Exactly one of `relative`
 * (fractional, about the mean) or `absolute` (in the observable's own unit) is
 * set. `gating` false means the observable is compared and reported but does
 * not decide the verdict — for quantities whose divergence diagnoses a method
 * rather than invalidating the comparison. `basis` records why the number is
 * what it is, so a tolerance is never an unexplained constant.
 */
export interface CrossMethodTolerance {
  relative?: number;
  absolute?: number;
  /** Defaults to true when absent. */
  gating?: boolean;
  basis?: string;
}

/**
 * Machine-readable counterpart to `formulaTeX`.
 *
 * `formulaTeX` is written for a human reader and carries presentational markup;
 * this is what a program evaluates, in the same grammar the dimensional check
 * already uses, so the corpus has one expression language rather than two.
 *
 * A card must declare this before a hypothesis card's limit claim can name it
 * as the thing it reduces to.
 */
export interface MachineFormula {
  /** Plain-ASCII expression, e.g. "y0 + v0*t - (1/2)*g*t**2". */
  expr: string;
  /** Every free symbol in `expr`, mapped to its dimensions. */
  symbols: Record<string, DimVec>;
  /**
   * What the expression actually encodes, in plain English. **Required**,
   * because `expr` need not be a transcription of `formulaTeX`: a card may
   * state the integrated form for a human and the differential form for a
   * machine. Without this a consumer assumes they are the same relation and
   * compares two expressions that were never meant to match.
   */
  relation: string;
}

/**
 * Qualifies how a claimed convergence order is measured.
 *
 * Exists because the engine was otherwise deciding a verdict with a number of
 * its own: `maxPerLevelSpread` separates "this refinement study is not a clean
 * power law" (`warn`) from "the method converges at the wrong rate" (`fail`). A
 * number that flips a verdict belongs in the card with its reasoning — the same
 * argument that gives {@link CrossMethodTolerance} a `basis`.
 */
/** A single `quantity op value` test. */
export interface Comparison {
  of: string;
  op: '<' | '<=' | '>' | '>=';
  value: number;
}

/**
 * A condition every reported sample of a quantity must satisfy.
 *
 * Structured rather than an expression: an expression language would need a
 * computer-algebra system, which would make the check Python-only like the
 * symbolic adapter. `where` is load-bearing — `Im chi_0(omega > 0) <= 0` says
 * nothing about negative frequencies, where Im chi is legitimately positive.
 */
export interface SeriesConditionSpec extends Comparison {
  where?: Comparison;
  /** Why this condition holds. */
  basis?: string;
}

export interface ConvergenceSpec {
  /** Which `validationEnvelopes` key holds the expected order. */
  orderKey?: string;
  /** How far per-level orders may spread before the study stops supporting an estimate. */
  maxPerLevelSpread?: number;
  /** Why this number. */
  basis?: string;
}

export interface PrincipleCard {
  /** Card-shape discriminator. 'principle' is the structural type, NOT the
   *  scientific subject — use `domain` for that. */
  kind: 'principle';
  id: string;
  version: string;
  name: string;
  /** Free-form subject area used for grouping. Examples:
   *  'physics-condensed-matter', 'physics-classical-mechanics',
   *  'chemistry-thermodynamics', 'chemistry-stoichiometry',
   *  'biology-population-dynamics', 'climate-radiative'. */
  domain?: string;
  principles: string[];
  formulaTeX: string;
  conventions: string[];
  expectedLimits: string[];
  references: string[];
  validationEnvelopes?: {
    plasmonOmegaP?: [number, number];
    gEarth_m_per_s2?: [number, number];
    gasConstant_J_per_molK?: [number, number];
    [other: string]: [number, number] | undefined;
  };
  /** How closely independent methods must agree on each observable, keyed by
   *  the same output keys `validationEnvelopes` uses. See
   *  {@link CrossMethodTolerance}. */
  crossMethodTolerances?: Record<string, CrossMethodTolerance>;
  /** Machine-readable counterpart to `formulaTeX`. See {@link MachineFormula}. */
  formula?: MachineFormula;
  /** How a claimed convergence order is measured. See {@link ConvergenceSpec}. */
  convergence?: ConvergenceSpec;
  /** Conditions every reported sample must satisfy. See {@link SeriesConditionSpec}. */
  seriesConditions?: SeriesConditionSpec[];
  metadata?: CardMetadata;
}

export interface OpsCard {
  kind: 'ops';
  id: string;
  version: string;
  name: string;
  description: string;
  parameters: Array<{
    key: string;
    label: string;
    defaultValue: string;
    required: boolean;
    note?: string;
  }>;
  validation: string[];
  references: string[];
  metadata?: CardMetadata;
}

export interface DimVec {
  L?: number;
  T?: number;
  M?: number;
  E?: number;
  Q?: number;
  Theta?: number;
  N?: number;
}

export interface DimensionalCheckSpec {
  lhsLabel: string;
  lhsDims: DimVec;
  rhsLabel: string;
  rhsDims: DimVec;
  /** Optional plain-ASCII RHS expression, e.g. "(1/2)*m*v**2". With
   *  `symbols`, the engine derives the RHS dimensions from the formula and
   *  checks them against lhsDims instead of trusting the declared rhsDims. */
  expr?: string;
  /** Optional map of symbol name to its dimension vector. */
  symbols?: Record<string, DimVec>;
}

/**
 * One equation of a coupled system: the time derivative of a state variable,
 * or an expression that vanishes at a fixed point.
 */
export interface SystemEquation {
  /** Which quantity this equation governs, e.g. 'x' for dx/dt. */
  of: string;
  expr: string;
}

/** Machine form of a limiting process — `b -> 0`, `K -> oo`. */
export interface LimitPoint {
  symbol: string;
  /** `0`, `oo`, `-oo`, or a numeric literal. */
  to: string;
}

/** Machine form of a root: the value at which the expression vanishes. */
export interface SolveForSpec {
  symbol: string;
}

/**
 * Machine form of a stationary point of a **coupled system**, which cannot be
 * found from a single equation — hence the system is declared here rather than
 * assumed from the card's own formula.
 */
export interface FixedPointSpec {
  system: SystemEquation[];
  solveFor: string[];
  /** Names the system introduces beyond the card's declared symbols. */
  parameters?: string[];
  /**
   * Inequalities selecting *which* fixed point is claimed, e.g. `y > 0`. A
   * coupled system usually has several, and verifying stationarity alone would
   * accept an extinction point for a claim about coexistence.
   */
  conditions?: string[];
}

/** What a claim reduces *to*. Exactly one form. */
export interface LimitTarget {
  /** Another corpus card, which must then declare `formula`. */
  cardId?: string;
  /** An inline expression. */
  expr?: string;
  /** Symbol -> expression, for a `fixedPoint` — an equilibrium is a tuple. */
  point?: Record<string, string>;
}

/**
 * A declared limit claim.
 *
 * `regime` and `expectedReducesTo` are the human-facing statement. The four
 * machine forms below are **mutually exclusive** — a limit, a substitution, a
 * root and a fixed point are different operations that give different answers,
 * so a claim declaring two is ambiguous rather than richer.
 *
 * Note the Node engine reads these fields but does not discharge them: there is
 * no comparable computer-algebra system in this ecosystem, so symbolic
 * discharge is Python-only. See `lemma/parity/README.md`.
 */
export interface LimitCheckSpec {
  name: string;
  regime: string;
  expectedReducesTo: string;
  /** A genuine limiting process. */
  limit?: LimitPoint;
  /** Setting a variable — disagrees with a limit wherever the function is
   *  discontinuous at the point. */
  substitute?: Record<string, string>;
  /** A root of the expression, not a limit of it. */
  solveFor?: SolveForSpec;
  /** A stationary point of a coupled system. */
  fixedPoint?: FixedPointSpec;
  target?: LimitTarget;
}

/**
 * Machine form of how a declared quantity evolves along the system's dynamics.
 *
 * `rate` of `"0"` is genuine conservation. A non-zero rate is a *dissipation*
 * claim — which is what both corpus cards carrying a conservation law actually
 * assert, so a checker that only tested "does the derivative vanish" would have
 * covered neither.
 */
export interface EvolutionSpec {
  quantity: string;
  system: SystemEquation[];
  rate: string;
  parameters?: string[];
}

/**
 * Conventional values for `ConservationLawSpec.law`, for tooling and authoring
 * hints. Deliberately NOT a union type: the point of widening was that the list
 * cannot be closed across every domain.
 */
export const CONVENTIONAL_CONSERVATION_LAWS = [
  'energy',
  'momentum',
  'charge',
  'particle-number',
  'total-spin',
  'parity',
  'mass',
  'probability',
  'lyapunov-function',
] as const;

export interface ConservationLawSpec {
  /**
   * Which quantity the claim is about. Free-form, exactly as `domain` is.
   *
   * This was a closed union of the six physics values, and the corpus showed it
   * breaking: `lotka-volterra-with-logistic-prey` is a population-dynamics card
   * that had to declare `law: 'energy'` for a Lyapunov function, so its own
   * statement opened "No conserved energy-like quantity." A type that forces a
   * card to mislabel itself is the domain-agnostic rule failing somewhere the
   * "no constants in the engine" check does not look.
   */
  law: string;
  statement: string;
  evolution?: EvolutionSpec;
}

export interface ReferenceCorpusCheckSpec {
  mustAgreeWith?: string[];
  mayContradict?: string[];
}

export interface HypothesisChecksSpec {
  dimensional?: DimensionalCheckSpec;
  limits?: LimitCheckSpec[];
  conservationLaws?: ConservationLawSpec[];
  referenceCorpus?: ReferenceCorpusCheckSpec;
}

export interface HypothesisCard {
  kind: 'hypothesis';
  id: string;
  version: string;
  name: string;
  proposal: string;
  proposedFormulaTeX: string;
  derivedFrom?: {
    cardId: string;
    relationship: 'extends' | 'replaces' | 'complements';
  };
  checks: HypothesisChecksSpec;
  references: string[];
  origin: 'llm' | 'human' | 'symbolic-regression';
  rationale?: string;
  metadata?: CardMetadata;
}

export type CheckSeverity = 'pass' | 'warn' | 'fail';

export interface UsceCheck {
  name: string;
  severity: CheckSeverity;
  detail: string;
}

export interface EvaluateResult {
  checks: UsceCheck[];
  diagnosis: string;
  overall: {
    passing: number;
    total: number;
    severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  };
}
