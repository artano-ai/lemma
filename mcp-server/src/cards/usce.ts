// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { formatG } from './format.js';
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
 *
 * `requireChecks` guards the case where nothing was checked at all — a card id
 * that did not resolve, a renamed output key, a stale corpus. By default that
 * returns NONE, which is honest ("no problem found") but reads identically to
 * "everything passed", so a caller gating on severity alone cannot tell a clean
 * verification from an absent one. Set it true wherever a *verification claim*
 * is being made and the empty case becomes HIGH instead.
 *
 * The default is deliberately the permissive one: only 13 of the 40 corpus
 * cards declare envelopes at all, so most outputs legitimately have nothing to
 * check, and flipping the default would change every severity-derived score
 * already committed to the benchmark landmarks.
 */
export function runUsceChecks(
  output: Record<string, number>,
  card: PrincipleCard,
  requireChecks = false,
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
        detail: `${key} = ${formatG(value)} is within [${formatG(lo)}, ${formatG(hi)}].`,
      });
    } else {
      checks.push({
        name: `USCE.envelope.${key}`,
        severity: 'fail',
        detail: `${key} = ${formatG(value)} is outside [${formatG(lo)}, ${formatG(hi)}] — the output violates the card's validation envelope.`,
      });
    }
  }

  const passing = checks.filter((c) => c.severity === 'pass').length;
  const total = checks.length;
  const anyFail = checks.some((c) => c.severity === 'fail');
  let severity: EvaluateResult['overall']['severity'] = anyFail ? 'HIGH' : 'NONE';

  let diagnosis: string;
  if (total === 0) {
    if (requireChecks) severity = 'HIGH';
    diagnosis =
      'No validation envelopes overlapped the provided output keys — nothing to check. Report the keys the card declares to verify them.';
    if (requireChecks)
      diagnosis +=
        ' Reported as a failure because this caller requires that a verification actually check something: an absent check must not be mistaken for a passing one.';
  } else if (anyFail) {
    diagnosis =
      "The output violates one or more of the card's validation envelopes — a finished result outside the card's stated bounds.";
  } else {
    diagnosis = "All checked values fall within the card's validation envelopes.";
  }

  return { checks, diagnosis, overall: { passing, total, severity } };
}
