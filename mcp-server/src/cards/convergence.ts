// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Verify a claimed convergence order against the refinement study behind it.
 *
 * Port of `run_convergence_check` in `sdk-py/artano_lemma/convergence.py`. The
 * two are contracted to byte-identical verdicts *and* byte-identical prose, so
 * every detail string here is the Python one character for character; numbers
 * go through {@link formatG} for the same reason.
 *
 * Unlike the symbolic adapter — which is Python-only because there is no
 * comparable computer-algebra system in this ecosystem — this is least-squares
 * arithmetic and has no excuse to diverge.
 *
 * ## What it checks, and why this rather than what was planned
 *
 * USCE range-checks the convergence order a *user reports*. Nothing checked
 * that the number was measured correctly, so the most safety-critical value on
 * a numerical-methods card was self-reported. This recomputes it from the
 * refinement study.
 *
 * ## The distinction it exists to preserve
 *
 * A sequence containing round-off-limited levels fits a shallower slope — the
 * test fixture gives 1.7, outside `[1.8, 2.2]`. Reporting that as `fail` would
 * say the scheme is not second-order when the scheme is fine and the *sequence*
 * is contaminated. `finite-difference-truncation-error` warns about precisely
 * this: "at very small h, subtraction of nearly-equal values amplifies machine
 * precision noise as 1/h". So a sequence that is not a clean power law returns
 * `warn` with the per-level orders attached, never `fail`.
 */

import { formatG } from './format.js';
import type { EvaluateResult, PrincipleCard, UsceCheck } from './types.js';

/** One level of a refinement study: `[h, error]`. */
export type ConvergencePoint = [number, number];

/** Both corpus cards that declare an order use this key. */
export const DEFAULT_CONVERGENCE_KEY = 'observedConvergenceOrder';

/**
 * Fallback used only when the card declares no `convergence.maxPerLevelSpread`.
 *
 * This number **decides verdicts** — it separates "not a clean power law"
 * (`warn`) from "wrong order" (`fail`) — so leaving it here unqualified put a
 * judgement in the engine that everywhere else in this system lives in the card
 * with a recorded `basis`. Cards can now declare it; where they do not, the
 * fallback applies **and the verdict says so**, so the provenance of the number
 * that decided the outcome is never silent.
 */
export const DEFAULT_SPREAD = 0.5;

function envelopeBounds(card: PrincipleCard, key: string): [number, number] | null {
  const value = card.validationEnvelopes?.[key];
  if (Array.isArray(value) && value.length === 2) return [Number(value[0]), Number(value[1])];
  return null;
}

/**
 * Least-squares slope of log(error) against log(h), plus per-level orders.
 *
 * The per-level orders are what make a bad fit diagnosable: a clean power law
 * gives roughly the same order between every consecutive pair, so a single
 * divergent entry points at the refinement level that broke rather than
 * condemning the whole study.
 */
export function estimateOrder(points: ConvergencePoint[]): {
  order: number;
  pairwise: number[];
} {
  const xs = points.map(([h]) => Math.log(h));
  const ys = points.map(([, e]) => Math.log(e));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - meanX) ** 2;
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
  }
  const order = sxy / sxx;

  const pairwise: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    if (xs[i] !== xs[i + 1]) {
      pairwise.push((ys[i]! - ys[i + 1]!) / (xs[i]! - xs[i + 1]!));
    }
  }
  return { order, pairwise };
}

export interface ConvergenceOptions {
  key?: string;
  spread?: number;
}

export function runConvergenceCheck(
  points: Iterable<ConvergencePoint>,
  card: PrincipleCard,
  options: ConvergenceOptions = {},
): EvaluateResult {
  // Precedence: explicit option > the card's own declaration > the fallback.
  // The card outranks the engine because a threshold that decides a verdict is
  // the card's judgement to make; the caller outranks both so a one-off study
  // can be re-examined without editing the corpus.
  const declared = card.convergence;
  const key = options.key ?? declared?.orderKey ?? DEFAULT_CONVERGENCE_KEY;
  let spread: number;
  let spreadSource: string;
  if (options.spread !== undefined) {
    spread = options.spread;
    spreadSource = 'supplied by the caller';
  } else if (declared?.maxPerLevelSpread !== undefined) {
    spread = declared.maxPerLevelSpread;
    spreadSource = `declared by ${card.id}`;
  } else {
    spread = DEFAULT_SPREAD;
    spreadSource = 'the engine default, not declared by this card';
  }
  const name = `USCE.convergence_${key}`;
  const checks: UsceCheck[] = [];

  const result = (severity: EvaluateResult['overall']['severity'], diagnosis: string): EvaluateResult => ({
    checks,
    diagnosis,
    overall: {
      passing: checks.filter((c) => c.severity === 'pass').length,
      total: checks.length,
      severity,
    },
  });

  const data: ConvergencePoint[] = [...points].map(([h, e]) => [Number(h), Number(e)]);
  const bounds = envelopeBounds(card, key);

  if (!bounds) {
    checks.push({
      name,
      severity: 'warn',
      detail:
        `Card "${card.id}" declares no ${key} envelope, so there is nothing to ` +
        `check the measured order against. Add one to make this claim verifiable.`,
    });
    return result('NONE', `No ${key} envelope on this card — the order was not checked.`);
  }

  if (data.length < 2) {
    checks.push({
      name,
      severity: 'warn',
      detail:
        `A convergence order needs at least two refinement levels; got ` +
        `${data.length}. Neither confirmed nor refuted.`,
    });
    return result('NONE', 'Too few refinement levels to estimate an order.');
  }

  const bad = data.find(([h, e]) => h <= 0 || e <= 0);
  if (bad) {
    checks.push({
      name,
      severity: 'warn',
      detail:
        `Refinement levels must have positive h and positive error to fit a power ` +
        `law; got (${formatG(bad[0])}, ${formatG(bad[1])}). An error of exactly zero usually means ` +
        `the exact solution was recovered at that level, which carries no order ` +
        `information.`,
    });
    return result('NONE', 'Refinement data is not fittable as a power law.');
  }

  if (new Set(data.map(([h]) => h)).size !== data.length) {
    checks.push({
      name,
      severity: 'warn',
      detail:
        'Two refinement levels share the same h, so the slope is undefined there. ' +
        'Neither confirmed nor refuted.',
    });
    return result('NONE', 'Duplicate refinement levels.');
  }

  // Coarsest first, so per-level orders read in refinement order.
  data.sort((a, b) => b[0] - a[0]);
  const { order, pairwise } = estimateOrder(data);
  const [lo, hi] = bounds;
  const rendered = pairwise.map((p) => formatG(p, 3)).join(', ');

  // Quality first. A contaminated sequence can land outside the envelope while
  // the scheme is perfectly correct, so the fit must be judged before the order.
  const span = pairwise.length >= 2 ? Math.max(...pairwise) - Math.min(...pairwise) : 0;
  if (pairwise.length >= 2 && span > spread) {
    checks.push({
      name,
      severity: 'warn',
      detail:
        `The refinement sequence is not a clean power law: per-level orders are ` +
        `${rendered}, spanning ${formatG(span, 3)} (> ${formatG(spread)}, ` +
        `${spreadSource}). ` +
        `The overall fit gives ${formatG(order, 3)}, but that number does not describe ` +
        `this data. A tail that flattens usually means round-off-limited levels ` +
        `at small h; a leading level that is off usually means the asymptotic ` +
        `regime had not been reached yet. Drop the offending levels and re-run ` +
        `rather than reading this as a verdict on the method.`,
    });
    return result(
      'NONE',
      'The refinement study does not support an order estimate — neither confirmed ' +
        'nor refuted. Inspect the per-level orders before drawing a conclusion.',
    );
  }

  if (order >= lo && order <= hi) {
    checks.push({
      name,
      severity: 'pass',
      detail:
        `Observed convergence order ${formatG(order, 4)} is within [${formatG(lo)}, ${formatG(hi)}], ` +
        `measured over ${data.length} refinement levels (per-level: ${rendered}).`,
    });
    return result('NONE', 'The measured convergence order matches the order the card declares.');
  }

  checks.push({
    name,
    severity: 'fail',
    detail:
      `Observed convergence order ${formatG(order, 4)} is outside [${formatG(lo)}, ${formatG(hi)}] ` +
      `(per-level: ${rendered}). The refinement study is a clean power law, so this ` +
      `is a genuine order mismatch rather than a noisy measurement — the method is ` +
      `not converging at the rate the card declares.`,
  });
  return result(
    'HIGH',
    'The measured convergence order contradicts the card. A clean power law at the ' +
      'wrong slope points at the implementation, not at the measurement.',
  );
}
