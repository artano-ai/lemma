// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Aggregation stats for the A/B runner.
 *
 *   - aggregateRuns(perPromptRuns)  — per-condition marginal: mean,
 *                                      std error, severity distribution.
 *   - pairedTTest(control, treatment)
 *                                    — paired t-test on per-prompt
 *                                      treatment-minus-control deltas.
 *                                      Returns mean delta, std error,
 *                                      t-statistic, degrees of freedom,
 *                                      two-tailed p-value, and 95% CI.
 *
 * The t-distribution math is implemented inline (lgamma via Lanczos,
 * regularised incomplete beta via continued fraction, CDF via the
 * beta identity, inverse CDF via bisection). No external numerical
 * dependencies — every line is auditable in this file.
 *
 * Verification against known critical values:
 *   tInverseCdf(0.975, 29)  ~= 2.0452 (textbook)
 *   tInverseCdf(0.975, ∞)   ~= 1.9600 (normal limit)
 *   tCdf(0, df)             == 0.5 for any df
 */
import type { CombinedScore, Severity } from './types.js';

export interface ConditionStats {
  mean_functional_pass_rate: number;
  mean_overall_score: number;
  std_err_overall_score: number;
  severity_distribution: Record<Severity, number>;
  n_observations: number;
}

/** Aggregate a list of per-prompt run sets into condition-level stats. */
export function aggregateRuns(perPromptRuns: CombinedScore[][]): ConditionStats {
  const flat = perPromptRuns.flat();
  const n = flat.length;
  if (n === 0) {
    return {
      mean_functional_pass_rate: 0,
      mean_overall_score: 0,
      std_err_overall_score: 0,
      severity_distribution: { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0 },
      n_observations: 0,
    };
  }

  const meanFunc = flat.reduce((s, x) => s + x.functional.pass_rate, 0) / n;
  const meanOverall = flat.reduce((s, x) => s + x.overall_score, 0) / n;

  let stdErr = 0;
  if (n > 1) {
    const variance =
      flat.reduce((s, x) => s + (x.overall_score - meanOverall) ** 2, 0) /
      (n - 1);
    stdErr = Math.sqrt(variance / n);
  }

  const dist: Record<Severity, number> = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const s of flat) dist[s.verification.severity]++;

  return {
    mean_functional_pass_rate: meanFunc,
    mean_overall_score: meanOverall,
    std_err_overall_score: stdErr,
    severity_distribution: dist,
    n_observations: n,
  };
}

// ─────────────────────────────────────────────────────────────────────
//   Paired t-test
// ─────────────────────────────────────────────────────────────────────

export interface PairedTestResult {
  n_prompts: number;
  mean_delta: number;
  std_dev_delta: number;
  std_err_delta: number;
  t_statistic: number;
  degrees_of_freedom: number;
  p_value_two_tailed: number;
  ci_95_low: number;
  ci_95_high: number;
  significant_at_0_05: boolean;
  per_prompt_deltas: number[];
}

/** Paired t-test on per-prompt treatment-minus-control deltas.
 *  When runs_per_condition > 1, deltas are computed on per-prompt
 *  *means* across runs — n is the number of prompts, not runs. This
 *  is the right granularity for the A/B claim ("Lemma changes the
 *  per-prompt outcome distribution"). */
export function pairedTTest(
  control: CombinedScore[][],
  treatment: CombinedScore[][],
  metric: 'overall_score' | 'functional_pass_rate' = 'overall_score',
): PairedTestResult {
  const n = Math.min(control.length, treatment.length);
  const deltas: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = meanOfMetric(control[i] ?? [], metric);
    const t = meanOfMetric(treatment[i] ?? [], metric);
    deltas.push(t - c);
  }

  if (n < 2) {
    return {
      n_prompts: n,
      mean_delta: deltas.length === 1 ? deltas[0]! : 0,
      std_dev_delta: 0,
      std_err_delta: 0,
      t_statistic: 0,
      degrees_of_freedom: Math.max(0, n - 1),
      p_value_two_tailed: 1,
      ci_95_low: 0,
      ci_95_high: 0,
      significant_at_0_05: false,
      per_prompt_deltas: deltas,
    };
  }

  const mean = deltas.reduce((s, d) => s + d, 0) / n;
  const variance =
    deltas.reduce((s, d) => s + (d - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  const stdErr = stdDev / Math.sqrt(n);
  const df = n - 1;

  // Guard against zero variance (every paired delta identical — happens
  // in the offline smoke when both arms run the reference adapter).
  let t = 0;
  let p = 1;
  let ciHalf = 0;
  if (stdErr > 0) {
    t = mean / stdErr;
    p = 2 * (1 - tCdf(Math.abs(t), df));
    const tCrit = tInverseCdf(0.975, df);
    ciHalf = tCrit * stdErr;
  } else if (mean !== 0) {
    // Non-zero mean with zero variance — degenerate, treat as conclusive.
    t = mean > 0 ? Infinity : -Infinity;
    p = 0;
  }

  return {
    n_prompts: n,
    mean_delta: mean,
    std_dev_delta: stdDev,
    std_err_delta: stdErr,
    t_statistic: t,
    degrees_of_freedom: df,
    p_value_two_tailed: p,
    ci_95_low: mean - ciHalf,
    ci_95_high: mean + ciHalf,
    significant_at_0_05: p < 0.05,
    per_prompt_deltas: deltas,
  };
}

function meanOfMetric(
  runs: CombinedScore[],
  metric: 'overall_score' | 'functional_pass_rate',
): number {
  if (runs.length === 0) return 0;
  const total = runs.reduce(
    (s, r) =>
      s + (metric === 'overall_score' ? r.overall_score : r.functional.pass_rate),
    0,
  );
  return total / runs.length;
}

// ─────────────────────────────────────────────────────────────────────
//   Distribution math (no external deps)
// ─────────────────────────────────────────────────────────────────────

/** Lanczos approximation to log Γ(z). Accurate to ~15 digits for z > 0. */
function lgamma(z: number): number {
  if (z < 0.5) {
    // Reflection formula: Γ(z) Γ(1-z) = π / sin(πz)
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  z -= 1;
  let x = p[0]!;
  for (let i = 1; i < g + 2; i++) x += p[i]! / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Continued-fraction expansion for the regularised incomplete beta.
 *  Numerical Recipes 3rd ed., section 6.4. */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-10;
  const FPMIN = 1e-30;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
function regIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBT =
    lgamma(a + b) -
    lgamma(a) -
    lgamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) {
    return (Math.exp(lnBT) * betacf(a, b, x)) / a;
  }
  return 1 - (Math.exp(lnBT) * betacf(b, a, 1 - x)) / b;
}

/** Student's t CDF. Uses the beta-function identity
 *    P(T <= t) = 1 - 0.5 * I_{df/(df+t²)}(df/2, 1/2)   for t >= 0
 *    P(T <= t) = 0.5 * I_{df/(df+t²)}(df/2, 1/2)       for t <  0
 */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const half = 0.5 * regIncompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - half : half;
}

/** Inverse t CDF — solve tCdf(t, df) = p by bisection. */
export function tInverseCdf(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -50;
  let hi = 50;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-10) break;
  }
  return (lo + hi) / 2;
}

// Legacy export retained for any caller still wired to the simple delta
// API. New code should use pairedTTest above.
export function pairedMeanDelta(
  control: CombinedScore[][],
  treatment: CombinedScore[][],
): { mean_delta: number; per_prompt_deltas: number[] } {
  const result = pairedTTest(control, treatment);
  return {
    mean_delta: result.mean_delta,
    per_prompt_deltas: result.per_prompt_deltas,
  };
}
