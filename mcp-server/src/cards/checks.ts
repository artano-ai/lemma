/**
 * Hypothesis cross-check engine.
 * Takes a HypothesisCard + the live PrincipleCard registry, runs the four
 * declared check classes, returns an EvaluateResult.
 *
 * v0:
 *   - dimensional analysis: real comparison of canonical DimVec
 *   - reference-corpus check: resolves declared mustAgreeWith / mayContradict
 *     ids against the live registry
 *   - limit checks: declarative — recorded with severity 'warn' pending
 *     symbolic verification (PySR / SymPy hookup planned)
 *   - conservation laws: same pattern as limits
 *   - derived-from: real link resolution against the corpus
 */
import type {
  ConservationLawSpec,
  DimensionalCheckSpec,
  EvaluateResult,
  HypothesisCard,
  LimitCheckSpec,
  PrincipleCard,
  ReferenceCorpusCheckSpec,
  UsceCheck,
} from './types.js';
import { deriveDims, DimDerivationError, dimsEqual, stringifyDims } from './dimensional.js';

export interface RunHypothesisChecksOptions {
  corpus: PrincipleCard[];
}

export function runHypothesisChecks(
  card: HypothesisCard,
  opts: RunHypothesisChecksOptions,
): EvaluateResult {
  const checks: UsceCheck[] = [];

  if (card.checks.dimensional) {
    checks.push(checkDimensional(card.checks.dimensional));
  }
  if (card.checks.referenceCorpus) {
    checks.push(checkReferenceCorpus(card.checks.referenceCorpus, opts.corpus));
  }
  if (card.checks.limits) {
    for (const lim of card.checks.limits) {
      checks.push(checkLimit(lim, opts.corpus));
    }
  }
  if (card.checks.conservationLaws) {
    for (const cons of card.checks.conservationLaws) {
      checks.push(checkConservationLaw(cons));
    }
  }
  if (card.derivedFrom) {
    checks.push(checkDerivedFrom(card.derivedFrom, opts.corpus));
  }

  const passing = checks.filter((c) => c.severity === 'pass').length;
  const total = checks.length;
  const anyFail = checks.some((c) => c.severity === 'fail');
  const anyWarn = checks.some((c) => c.severity === 'warn');
  const severity: EvaluateResult['overall']['severity'] = anyFail
    ? 'HIGH'
    : anyWarn
      ? 'LOW'
      : 'NONE';

  let diagnosis: string;
  if (anyFail) {
    diagnosis =
      'Hypothesis fails one or more hard cross-checks. Reject or refine before any human review — the cited contradictions point to either a malformed proposal or a corpus inconsistency that itself needs auditing.';
  } else if (anyWarn) {
    diagnosis =
      'Hypothesis passes hard checks (dimensional analysis, reference resolution) but its limit / conservation claims have not been formally verified. Human reviewer or symbolic engine (SymPy/PySR) should close the open warnings before promotion to a verified card.';
  } else {
    diagnosis =
      'All declared cross-checks pass. The hypothesis is internally consistent and resolvable against the corpus — it is a candidate for human promotion to a verified card.';
  }

  return { checks, diagnosis, overall: { passing, total, severity } };
}

function checkDimensional(spec: DimensionalCheckSpec): UsceCheck {
  // With a formula (`expr`) + per-symbol dims (`symbols`), derive the RHS
  // dimensions and check them against lhsDims — verifying the equation, not
  // just the declared rhsDims. Non-derivable expressions fall back so we
  // never emit a fabricated verdict.
  if (spec.expr && spec.symbols) {
    try {
      const derived = deriveDims(spec.expr, spec.symbols);
      if (dimsEqual(spec.lhsDims, derived)) {
        return {
          name: 'Hypothesis.dimensional_analysis',
          severity: 'pass',
          detail: `Derived from formula: ${spec.rhsLabel} = ${stringifyDims(derived)} matches LHS [${spec.lhsLabel}] = ${stringifyDims(spec.lhsDims)}`,
        };
      }
      return {
        name: 'Hypothesis.dimensional_analysis',
        severity: 'fail',
        detail: `Dimensional mismatch — the formula ${spec.rhsLabel} derives to ${stringifyDims(derived)}, but LHS [${spec.lhsLabel}] is ${stringifyDims(spec.lhsDims)}. The proposed equation does not hold dimensionally.`,
      };
    } catch (err) {
      if (!(err instanceof DimDerivationError)) throw err;
      return declaredDimensional(
        spec,
        ` (formula not derivable — ${err.message}; compared declared vectors)`,
      );
    }
  }
  return declaredDimensional(spec);
}

function declaredDimensional(spec: DimensionalCheckSpec, note = ''): UsceCheck {
  if (dimsEqual(spec.lhsDims, spec.rhsDims)) {
    return {
      name: 'Hypothesis.dimensional_analysis',
      severity: 'pass',
      detail: `LHS [${spec.lhsLabel}] = ${stringifyDims(spec.lhsDims)} matches RHS [${spec.rhsLabel}] = ${stringifyDims(spec.rhsDims)}${note}`,
    };
  }
  return {
    name: 'Hypothesis.dimensional_analysis',
    severity: 'fail',
    detail: `Dimensional mismatch — LHS ${stringifyDims(spec.lhsDims)} vs RHS ${stringifyDims(spec.rhsDims)}. The proposed equation is not even a candidate without a missing factor.${note}`,
  };
}

function checkReferenceCorpus(
  spec: ReferenceCorpusCheckSpec,
  corpus: PrincipleCard[],
): UsceCheck {
  const known = new Set(corpus.map((c) => c.id));
  const must = spec.mustAgreeWith ?? [];
  const may = spec.mayContradict ?? [];
  const missingMust = must.filter((id) => !known.has(id));
  const missingMay = may.filter((id) => !known.has(id));
  const allMissing = [...missingMust, ...missingMay];

  if (allMissing.length > 0) {
    return {
      name: 'Hypothesis.reference_corpus',
      severity: 'fail',
      detail: `Declared reference cards not in corpus: ${allMissing.join(', ')}. Hypothesis cannot be cross-checked against missing references.`,
    };
  }
  return {
    name: 'Hypothesis.reference_corpus',
    severity: 'pass',
    detail: `All declared references resolve — ${must.length} mustAgreeWith (${must.join(', ') || '∅'}), ${may.length} mayContradict (${may.join(', ') || '∅'}).`,
  };
}

function checkLimit(spec: LimitCheckSpec, corpus: PrincipleCard[]): UsceCheck {
  const knownIds = new Set(corpus.map((c) => c.id));
  const reducesToCard = knownIds.has(spec.expectedReducesTo);
  return {
    name: `Hypothesis.limit_${spec.name}`,
    severity: 'warn',
    detail: reducesToCard
      ? `Claim recorded: in the regime ${spec.regime}, the proposal should reduce to "${spec.expectedReducesTo}" (corpus card). Symbolic verification pending.`
      : `Claim recorded: in the regime ${spec.regime}, the proposal should reduce to ${spec.expectedReducesTo}. Symbolic verification pending.`,
  };
}

function checkConservationLaw(spec: ConservationLawSpec): UsceCheck {
  return {
    name: `Hypothesis.conservation_${spec.law}`,
    severity: 'warn',
    detail: `Claim recorded: ${spec.law} conservation — ${spec.statement}. Symbolic / numeric verification pending.`,
  };
}

function checkDerivedFrom(
  spec: NonNullable<HypothesisCard['derivedFrom']>,
  corpus: PrincipleCard[],
): UsceCheck {
  const known = new Set(corpus.map((c) => c.id));
  if (!known.has(spec.cardId)) {
    return {
      name: 'Hypothesis.derived_from',
      severity: 'fail',
      detail: `Hypothesis declares it ${spec.relationship} card "${spec.cardId}", which is not in the corpus.`,
    };
  }
  return {
    name: 'Hypothesis.derived_from',
    severity: 'pass',
    detail: `Hypothesis ${spec.relationship} corpus card "${spec.cardId}" — link resolves.`,
  };
}
