// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import type { EvaluateResult, PrincipleCard, UsceCheck } from './types.js';

/**
 * USCE — Universal Sanity Check Engine. Verifies a finished output against a
 * card's validation envelopes.
 *
 * Range-checks the numeric values in `output` against the `validationEnvelopes`
 * declared by `card`. For each envelope key present in `output`, the value must
 * fall within the declared [min, max] range: inside is `pass`, outside is
 * `fail` (the output violates the card's stated bounds). Envelope keys absent
 * from `output` are skipped. The overall severity is HIGH if any check fails,
 * else NONE — the same worst-wins roll-up the cross-check engine uses.
 *
 * v1 scope is the envelope (peak-vs-range) check. Causality and
 * asymptotic-decay checks over time-series outputs are future work.
 */
export function runUsceChecks(
  output: Record<string, number>,
  card: PrincipleCard,
): EvaluateResult {
  const envelopes = card.validationEnvelopes ?? {};
  const checks: UsceCheck[] = [];
  for (const [key, env] of Object.entries(envelopes)) {
    if (!env || !(key in output)) continue;
    const [lo, hi] = env;
    const value = output[key]!;
    if (value >= lo && value <= hi) {
      checks.push({
        name: `USCE.envelope.${key}`,
        severity: 'pass',
        detail: `${key} = ${value} is within [${lo}, ${hi}].`,
      });
    } else {
      checks.push({
        name: `USCE.envelope.${key}`,
        severity: 'fail',
        detail: `${key} = ${value} is outside [${lo}, ${hi}] -- the output violates the card's validation envelope.`,
      });
    }
  }

  const passing = checks.filter((c) => c.severity === 'pass').length;
  const total = checks.length;
  const anyFail = checks.some((c) => c.severity === 'fail');
  const severity: EvaluateResult['overall']['severity'] = anyFail ? 'HIGH' : 'NONE';

  let diagnosis: string;
  if (total === 0) {
    diagnosis =
      'No validation envelopes overlapped the provided output keys -- nothing to check. Report the keys the card declares to verify them.';
  } else if (anyFail) {
    diagnosis =
      "The output violates one or more of the card's validation envelopes -- a finished result outside the card's stated bounds.";
  } else {
    diagnosis = "All checked values fall within the card's validation envelopes.";
  }

  return { checks, diagnosis, overall: { passing, total, severity } };
}
