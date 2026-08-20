// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Check a reported series against declared sign and bound conditions.
 *
 * Port of `run_series_checks` in `sdk-py/artano_lemma/series.py`. Detail strings
 * are the Python ones character for character and numbers go through
 * {@link formatG}, because the two engines are contracted to byte-identical
 * prose.
 *
 * ## Why this reaches cards nothing else could
 *
 * Five corpus cards are **declared envelope refusals** — their values have no
 * system-independent range, so any numeric bound would encode one calculation's
 * setup rather than the physics. Two of them nevertheless carry a condition that
 * *is* universal: `density-of-states` states `g(epsilon) >= 0` and `joint-dos`
 * states `J(omega) >= 0`. A density of states cannot be negative in any
 * material, at any k-mesh, under any smearing. The magnitude is unboundable; the
 * sign is not.
 *
 * So this gives verification coverage to cards the envelope check structurally
 * cannot reach — a larger gain than another check on already-covered cards.
 *
 * ## Why conditions are structured rather than expressions
 *
 * An expression language would need a computer-algebra system to evaluate,
 * making this Python-only like the symbolic adapter. A structured comparison is
 * arithmetic both runtimes do identically. Every real claim in the corpus fits
 * that shape; none needs algebra.
 */

import { formatG } from './format.js';
import type { EvaluateResult, PrincipleCard, UsceCheck } from './types.js';

export type ComparisonOperator = '>' | '>=' | '<' | '<=';

const OPS: Record<ComparisonOperator, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '<=': (a, b) => a <= b,
};

/**
 * One declared condition on a reported series.
 *
 * `where` optionally restricts which samples the claim covers — a claim about
 * `omega > 0` says nothing about negative frequencies, and testing it there
 * would manufacture a violation the card never asserted.
 */
export interface SeriesCondition {
  of: string;
  op: ComparisonOperator;
  value: number;
  where?: { of: string; op: ComparisonOperator; value: number };
}

function describe(condition: SeriesCondition): string {
  let text = `${condition.of} ${condition.op} ${formatG(condition.value)}`;
  if (condition.where) {
    text += ` where ${condition.where.of} ${condition.where.op} ${formatG(condition.where.value)}`;
  }
  return text;
}

export function runSeriesChecks(
  series: Record<string, readonly number[]>,
  card: PrincipleCard,
  conditions?: readonly SeriesCondition[],
): EvaluateResult {
  // Defaults to whatever the CARD declares. Passing conditions explicitly is
  // for exploring a claim a card does not yet carry; the corpus is the normal
  // source, so that a condition stated in a card is actually enforced rather
  // than depending on every caller to remember it.
  const active: readonly SeriesCondition[] = conditions ?? (card.seriesConditions ?? []);
  const checks: UsceCheck[] = [];
  const columns: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(series)) columns[key] = value.map(Number);

  const finish = (): EvaluateResult => {
    const passing = checks.filter((c) => c.severity === 'pass').length;
    const anyFail = checks.some((c) => c.severity === 'fail');
    let diagnosis: string;
    if (anyFail) {
      diagnosis =
        'A reported series violates a condition the card declares. Unlike a value ' +
        'outside an envelope, a sign violation is not a matter of tolerance — the ' +
        'quantity is outside its own definition.';
    } else if (checks.length === 0) {
      diagnosis =
        'This card declares no seriesConditions and none were supplied, so ' +
        'nothing was checked.';
    } else if (passing === checks.length) {
      diagnosis = 'Every declared condition holds across the reported series.';
    } else {
      diagnosis =
        'Some conditions could not be evaluated against the series provided — ' +
        'recorded, neither confirmed nor refuted.';
    }
    return {
      checks,
      diagnosis,
      overall: { passing, total: checks.length, severity: anyFail ? 'HIGH' : 'NONE' },
    };
  };

  const lengths = [...new Set(Object.values(columns).map((v) => v.length))];
  if (lengths.length > 1) {
    const rendered = lengths.sort((a, b) => a - b).join(', ');
    for (const condition of active) {
      checks.push({
        name: `USCE.series_${condition.of}`,
        severity: 'warn',
        detail:
          `The reported columns have different lengths (${rendered}), ` +
          `so they are not samples of one series and cannot be compared point by point.`,
      });
    }
    return finish();
  }

  for (const condition of active) {
    const name = `USCE.series_${condition.of}`;
    const described = describe(condition);

    if (!(condition.of in columns)) {
      const reported = Object.keys(columns).sort().join(', ') || 'nothing';
      checks.push({
        name,
        severity: 'warn',
        detail:
          `Condition "${described}" was declared, but the run reports no ` +
          `"${condition.of}" series. Reported: ` +
          `${reported}. Neither confirmed nor refuted.`,
      });
      continue;
    }

    const values = columns[condition.of]!;
    let indices = values.map((_, i) => i);

    if (condition.where) {
      if (!(condition.where.of in columns)) {
        checks.push({
          name,
          severity: 'warn',
          detail:
            `Condition "${described}" restricts to "${condition.where.of}", ` +
            `which the run does not report, so the samples it covers cannot be ` +
            `identified. Neither confirmed nor refuted.`,
        });
        continue;
      }
      const gate = columns[condition.where.of]!;
      const predicate = OPS[condition.where.op];
      indices = indices.filter((i) => predicate(gate[i]!, condition.where!.value));
    }

    const selected = indices.map((i) => [i, values[i]!] as const);
    if (selected.length === 0) {
      checks.push({
        name,
        severity: 'warn',
        detail:
          `Condition "${described}" covers no reported sample, so it is ` +
          `vacuous here — neither confirmed nor refuted. Report samples inside ` +
          `the declared domain to test it.`,
      });
      continue;
    }

    const nans = selected.filter(([, v]) => Number.isNaN(v));
    if (nans.length > 0) {
      checks.push({
        name,
        severity: 'warn',
        detail:
          `Condition "${described}" cannot be evaluated: ${nans.length} of ` +
          `${selected.length} covered samples are NaN. A comparison against NaN is ` +
          `false for every operator, so treating this as a violation would ` +
          `manufacture a verdict out of missing data.`,
      });
      continue;
    }

    const predicate = OPS[condition.op];
    const violations = selected.filter(([, v]) => !predicate(v, condition.value));

    if (violations.length === 0) {
      checks.push({
        name,
        severity: 'pass',
        detail: `${described} holds across all ${selected.length} covered samples.`,
      });
      continue;
    }

    // Report the worst offender, not merely the first: it is the one that tells
    // you how badly the run is broken.
    let worst = violations[0]!;
    for (const candidate of violations) {
      if (Math.abs(candidate[1] - condition.value) > Math.abs(worst[1] - condition.value)) {
        worst = candidate;
      }
    }
    checks.push({
      name,
      severity: 'fail',
      detail:
        `${described} is violated by ${violations.length} of ${selected.length} covered ` +
        `samples; the worst is ${formatG(worst[1])} at index ${worst[0]}. This is not a ` +
        `tolerance question — the quantity is outside its own definition.`,
    });
  }

  return finish();
}
