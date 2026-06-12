// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Sanity check for the stats module.
 *
 * Validates the Student-t implementation against textbook critical
 * values, then runs a synthetic paired t-test to confirm the test
 * actually rejects a null where it should and fails to reject where
 * it should not.
 *
 * If any line below prints "FAIL", the t-distribution math is wrong
 * and any p-values produced by the harness are unreliable.
 */
import { pairedTTest, tCdf, tInverseCdf } from '../scorer/stats.js';
import type { CombinedScore } from '../scorer/types.js';

function approx(a: number, b: number, tol = 1e-3): boolean {
  return Math.abs(a - b) < tol;
}

function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

console.log('\n=== Student-t distribution (known critical values) ===\n');

// tCdf at t=0 must be 0.5 for any df.
check('tCdf(0, df=5)  == 0.5', approx(tCdf(0, 5), 0.5), `got ${tCdf(0, 5).toFixed(4)}`);
check('tCdf(0, df=29) == 0.5', approx(tCdf(0, 29), 0.5), `got ${tCdf(0, 29).toFixed(4)}`);

// Two-tailed 95% critical value at df=29: t ≈ 2.0452 (textbook).
const tCrit29 = tInverseCdf(0.975, 29);
check('tInverseCdf(0.975, df=29) ≈ 2.045', approx(tCrit29, 2.0452, 5e-3), `got ${tCrit29.toFixed(4)}`);

// At large df the t-distribution approaches the standard normal:
// z(0.975) = 1.95996. Check df=10000.
const tCritLarge = tInverseCdf(0.975, 10000);
check('tInverseCdf(0.975, df=10000) ≈ 1.960', approx(tCritLarge, 1.96, 5e-3), `got ${tCritLarge.toFixed(4)}`);

// One-tailed 95%: df=29 critical ≈ 1.6991
const tCrit29one = tInverseCdf(0.95, 29);
check('tInverseCdf(0.95, df=29)  ≈ 1.699', approx(tCrit29one, 1.6991, 5e-3), `got ${tCrit29one.toFixed(4)}`);

// Round-trip: tCdf(tInverseCdf(p, df), df) ≈ p.
const p_in = 0.975;
const t_in = tInverseCdf(p_in, 29);
const p_out = tCdf(t_in, 29);
check('round-trip tCdf(tInv(0.975))', approx(p_out, p_in, 1e-6), `got ${p_out.toFixed(6)}`);

console.log('\n=== Paired t-test (synthetic) ===\n');

function makeRuns(scores: number[]): CombinedScore[][] {
  // Wrap each scalar into a single-run CombinedScore so the runs-shape
  // matches what pairedTTest expects.
  return scores.map((s) => [
    {
      prompt_id: 'synthetic',
      card_ids: [],
      functional: { passed: 0, total: 0, pass_rate: s, failures: [] },
      verification: { severity: 'NONE', passing: 0, total: 0, details: [] },
      overall_score: s,
    },
  ]);
}

// Scenario A: identical scores → mean delta = 0, p = 1.
const ctrlA = makeRuns([0.5, 0.6, 0.7, 0.8, 0.9, 0.5, 0.6, 0.7, 0.8, 0.9]);
const treatA = makeRuns([0.5, 0.6, 0.7, 0.8, 0.9, 0.5, 0.6, 0.7, 0.8, 0.9]);
const resA = pairedTTest(ctrlA, treatA);
check(
  'identical samples: mean_delta = 0',
  approx(resA.mean_delta, 0) && resA.p_value_two_tailed >= 0.99,
  `mean=${resA.mean_delta.toFixed(3)} p=${resA.p_value_two_tailed.toFixed(3)} t=${resA.t_statistic.toFixed(2)}`,
);

// Scenario B: treatment uniformly +0.2 → should be highly significant.
const ctrlB = makeRuns([0.3, 0.4, 0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.4, 0.5]);
const treatB = makeRuns(ctrlB.map(c => c[0]!.overall_score + 0.2));
const resB = pairedTTest(ctrlB, treatB);
check(
  'uniform +0.2 shift: highly significant',
  approx(resB.mean_delta, 0.2) && resB.p_value_two_tailed < 0.001,
  `mean=${resB.mean_delta.toFixed(3)} p=${resB.p_value_two_tailed.toExponential(2)} t=${resB.t_statistic.toFixed(2)}`,
);

// Scenario C: tiny noisy shift (+0.01 mean, std≈0.1 noise) → not significant.
const ctrlC = makeRuns(Array.from({ length: 30 }, () => 0.5));
const noise = Array.from({ length: 30 }, (_, i) => Math.sin(i) * 0.1);
const treatC = makeRuns(noise.map((n) => 0.51 + n));
const resC = pairedTTest(ctrlC, treatC);
check(
  'small noisy effect: not significant',
  !resC.significant_at_0_05,
  `mean=${resC.mean_delta.toFixed(3)} p=${resC.p_value_two_tailed.toFixed(3)} t=${resC.t_statistic.toFixed(2)}`,
);

console.log('');
