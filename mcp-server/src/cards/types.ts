/**
 * Minimal card schema types for the MCP server, covering the fragment
 * the cards.* and hypothesis.* tools need. The canonical schema lives in
 * `schema/card.v0.1.json`; this file is a hand-typed projection of it.
 */

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

export interface LimitCheckSpec {
  name: string;
  regime: string;
  expectedReducesTo: string;
}

export interface ConservationLawSpec {
  law:
    | 'energy'
    | 'momentum'
    | 'charge'
    | 'particle-number'
    | 'total-spin'
    | 'parity';
  statement: string;
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
