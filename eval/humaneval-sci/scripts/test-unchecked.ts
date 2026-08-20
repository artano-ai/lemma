// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * The `UNCHECKED` outcome: a check the engine *declined to run* must not be
 * charged as if it were a defect it found.
 *
 * Run: `pnpm test-unchecked`
 *
 * Why this file exists. The engine's own discipline is that "cannot check" and
 * "checked, and it is wrong" must never share a code path. The scorer that
 * consumes it violated exactly that: `SEVERITY_PENALTY.LOW = 0.25`, and `LOW`
 * was what a *declined* check produced, so functionally-perfect code carrying
 * one undischarged claim scored `1.0 x 0.75 = 0.75` and 1.0 was arithmetically
 * unreachable. Every historical number was measured against that ceiling.
 *
 * The distinction is not cosmetic, and the differential scorer proves it:
 * `differential.setup` emits LOW when it *could not extract a function name*
 * (a decline), while the probe summary emits LOW when 70-95% of probes matched
 * (a real, minor finding). Collapsing those two into one penalty is the bug.
 * One must become free; the other must keep costing 0.25.
 *
 * These assertions run through the REAL engine wherever the behaviour under
 * test is a mapping (engine verdict -> outcome). Hand-built score objects are
 * used only where the unit genuinely is the arithmetic.
 */

import assert from 'node:assert/strict';

import { combine, scoreVerification } from '../scorer/verification.js';
import { aggregateOutcomes, PENALTY, isDecline } from '../scorer/outcome.js';
import { aggregateRuns } from '../scorer/stats.js';
import type {
  CombinedScore,
  FunctionalScore,
  PromptDefinition,
} from '../scorer/types.js';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ok  ${name}`);
    })
    .catch((err: Error) => {
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err.message}`);
      process.exitCode = 1;
    });
}

const perfect: FunctionalScore = {
  passed: 4,
  total: 4,
  pass_rate: 1.0,
  failures: [],
};

const prompt = (over: Partial<PromptDefinition> = {}): PromptDefinition =>
  ({
    id: 'p',
    card_ids: [],
    domain: 'physics',
    language: 'python',
    prompt: 'p',
    reference_solution: '',
    test_cases: [],
    verification_targets: {},
    ...over,
  }) as PromptDefinition;

console.log('unchecked outcome');

// --- the real path: engine `warn` must become a free decline -----------------

await check('an undischarged limit claim scores 1.0 end-to-end', async () => {
  // The engine emits `warn` ("claim recorded ... verification pending") for
  // every declared limit. That is a decline, and must cost nothing.
  const p = prompt({ verification_targets: { limits: ['v -> 0 gives F -> 0'] } });
  const v = await scoreVerification(p);
  assert.ok(v.unchecked >= 1, `expected >=1 unchecked, got ${v.unchecked}`);
  assert.equal(v.severity, 'NONE');
  assert.equal(combine(p, perfect, v).overall_score, 1.0);
});

await check('an undischarged conservation claim scores 1.0 end-to-end', async () => {
  const p = prompt({ verification_targets: { conservation_laws: ['energy'] } });
  const v = await scoreVerification(p);
  assert.ok(v.unchecked >= 1, `expected >=1 unchecked, got ${v.unchecked}`);
  assert.equal(v.severity, 'NONE');
  assert.equal(combine(p, perfect, v).overall_score, 1.0);
});

await check('a prompt declaring nothing reports zero declines', async () => {
  // Control for the two above: proves `unchecked` tracks real declines and is
  // not simply always-positive.
  const p = prompt();
  const v = await scoreVerification(p);
  assert.equal(v.unchecked, 0);
  assert.equal(v.severity, 'NONE');
});

await check('every declined check is labelled UNCHECKED in the details', async () => {
  const p = prompt({ verification_targets: { limits: ['a -> b'] } });
  const v = await scoreVerification(p);
  const declines = v.details.filter((d) => d.severity === 'UNCHECKED');
  assert.ok(declines.length >= 1, 'no detail line marked UNCHECKED');
  assert.ok(
    declines.every((d) => /pending|recorded/i.test(d.detail)),
    'a line marked UNCHECKED does not read as a decline',
  );
});

// --- the arithmetic ---------------------------------------------------------

await check('UNCHECKED carries penalty 0.0, distinct from LOW', () => {
  assert.equal(PENALTY.UNCHECKED, 0.0);
  assert.equal(PENALTY.LOW, 0.25);
  assert.notEqual(PENALTY.UNCHECKED, PENALTY.LOW);
});

await check('all-declined aggregates to NONE, not LOW', () => {
  // The engine returns overall LOW when every finding is a decline. That is
  // the ceiling, and it must not survive aggregation.
  assert.equal(aggregateOutcomes(['UNCHECKED', 'UNCHECKED']), 'NONE');
});

await check('a decline never masks or softens a real finding', () => {
  assert.equal(aggregateOutcomes(['UNCHECKED', 'LOW']), 'LOW');
  assert.equal(aggregateOutcomes(['UNCHECKED', 'HIGH', 'LOW']), 'HIGH');
});

await check('isDecline separates the two differential LOWs', () => {
  // The half that must become free: the harness could not run the check.
  assert.equal(isDecline('differential.setup'), true);
  // The half that must keep costing 0.25: probes ran and 70-95% matched.
  assert.equal(isDecline('differential.summary'), false);
  assert.equal(isDecline('differential.probe_failed'), false);
});

// --- coverage must stay visible ---------------------------------------------

await check('aggregate reports declines so coverage is not invisible', () => {
  // Without this, a run where nothing could be checked is indistinguishable
  // from a run where everything passed: both read as severity NONE. The score
  // no longer carries that information, so the aggregate must.
  const mk = (unchecked: number): CombinedScore => ({
    prompt_id: 'p',
    card_ids: [],
    functional: perfect,
    verification: { severity: 'NONE', unchecked, passing: 0, total: 0, details: [] },
    overall_score: 1.0,
  });
  const agg = aggregateRuns([[mk(2)], [mk(0)]]);
  assert.equal(agg.total_unchecked, 2);
  assert.equal(agg.mean_unchecked, 1);
});

// --- regression guard (passes before and after; that is the point) ----------

await check('GUARD: a real minor finding still costs 0.25', () => {
  const c = combine(prompt(), perfect, {
    severity: 'LOW',
    unchecked: 0,
    passing: 0,
    total: 0,
    details: [],
  });
  assert.equal(c.overall_score, 0.75);
});

console.log(`\n${passed} checks passed`);
