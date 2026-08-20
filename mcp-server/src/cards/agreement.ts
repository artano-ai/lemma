// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { formatG } from './format.js';
import type { CheckSeverity, EvaluateResult, PrincipleCard, UsceCheck } from './types.js';

/**
 * Check whether independent methods agree, per a card's tolerances.
 *
 * `outputs` maps a method name to that method's observables, e.g.
 * `{ madar: { latticeConstant_A: 5.470 }, kavosh: { ... } }`. For each key in
 * the card's `crossMethodTolerances` reported by at least two methods, the
 * spread (max - min) is tested against the declared tolerance: `relative`
 * about the mean, or `absolute` in the observable's own unit.
 *
 * This is the counterpart to `runUsceChecks`, one relation higher: an envelope
 * bounds a single run's value, this bounds the disagreement *between* runs.
 * Both are generic — the physics lives in the card, never here.
 *
 * Observables marked `gating: false` are compared and reported but do not
 * decide the verdict, so a quantity whose divergence diagnoses a method can be
 * surfaced honestly without failing the comparison.
 *
 * Unlike the envelope check, **an empty result is a failure, not a pass.**
 * Fewer than two methods throws; zero comparable observables returns HIGH. A
 * comparison that checked nothing must never be indistinguishable from one
 * that checked everything and agreed.
 *
 * Port of `run_agreement_checks` in `../../../sdk-py/artano_lemma/engine.py`.
 */
export function runAgreementChecks(
  outputs: Record<string, Record<string, number>>,
  card: PrincipleCard,
): EvaluateResult {
  const methods = Object.keys(outputs);
  if (methods.length < 2) {
    throw new Error(
      `cross-method agreement needs at least two methods, got ${methods.length} ` +
        `(${[...methods].sort().join(', ')}). A single method cannot corroborate itself.`,
    );
  }

  const tolerances = card.crossMethodTolerances ?? {};
  const checks: UsceCheck[] = [];
  const skipped: string[] = [];

  for (const [key, tol] of Object.entries(tolerances)) {
    const reported = methods
      .filter((m) => key in outputs[m]!)
      .map((m) => [m, outputs[m]![key]!] as const);
    if (reported.length < 2) {
      skipped.push(key);
      continue;
    }
    const values = reported.map(([, v]) => v);
    let spread = Math.max(...values) - Math.min(...values);
    let limit: number;
    let unit: string;
    if (tol.relative !== undefined) {
      const scale = Math.abs(values.reduce((a, b) => a + b, 0) / values.length);
      if (scale === 0) {
        skipped.push(key);
        continue;
      }
      spread = spread / scale;
      limit = tol.relative;
      unit = 'relative';
    } else {
      limit = tol.absolute ?? 0;
      unit = 'absolute';
    }

    const gating = tol.gating ?? true;
    const agree = spread <= limit;
    const rendered = [...reported]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([m, v]) => `${m}=${formatG(v)}`)
      .join(', ');

    let severity: CheckSeverity;
    let verdict: string;
    if (agree) {
      severity = 'pass';
      verdict = `spread ${formatG(spread, 4)} is within the ${unit} tolerance ${formatG(limit)}`;
    } else if (gating) {
      severity = 'fail';
      verdict = `spread ${formatG(spread, 4)} exceeds the ${unit} tolerance ${formatG(limit)}`;
    } else {
      severity = 'warn';
      verdict =
        `spread ${formatG(spread, 4)} exceeds the ${unit} tolerance ${formatG(limit)}, ` +
        `reported but not gating`;
    }
    checks.push({
      name: `Agreement.${key}`,
      severity,
      detail: `${key}: ${rendered} — ${verdict}.`,
    });
  }

  const passing = checks.filter((c) => c.severity === 'pass').length;
  const total = checks.length;
  const anyFail = checks.some((c) => c.severity === 'fail');
  const anyWarn = checks.some((c) => c.severity === 'warn');
  const notComparable = [...skipped].sort().join(', ');

  let severity: EvaluateResult['overall']['severity'];
  let diagnosis: string;
  if (total === 0) {
    severity = 'HIGH';
    diagnosis =
      'No observable was reported by two or more methods, so nothing was compared. ' +
      'This is not agreement — it is an absent comparison, and is reported as a ' +
      'failure so it cannot be mistaken for one.';
    if (skipped.length) diagnosis += ` Declared but not comparable: ${notComparable}.`;
  } else {
    if (anyFail) {
      severity = 'HIGH';
      diagnosis =
        "The methods disagree beyond the card's tolerance on at least one gating " +
        'observable. Agreement is evidence of consistency, not correctness — but ' +
        'disagreement at this scale means the methods are not describing the same result.';
    } else if (anyWarn) {
      severity = 'LOW';
      diagnosis =
        'The methods agree on every gating observable. A non-gating observable diverges; ' +
        'that diagnoses a method rather than invalidating the comparison, and is reported.';
    } else {
      severity = 'NONE';
      diagnosis =
        `All ${total} compared observables agree within the card's tolerances across ` +
        `${methods.length} methods.`;
    }
    if (skipped.length)
      diagnosis += ` Not comparable (reported by fewer than two methods): ${notComparable}.`;
  }

  return { checks, diagnosis, overall: { passing, total, severity } };
}
