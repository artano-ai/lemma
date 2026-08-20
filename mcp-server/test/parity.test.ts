// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Cross-language parity: the TypeScript half.
 *
 * The engine ships twice — here and in `sdk-py/artano_lemma/engine.py` — and
 * they are contracted to return byte-identical verdicts *and* byte-identical
 * prose. Until this test existed, nothing enforced that: each language tested
 * itself against its own output, so both suites stayed green while the two
 * drifted apart.
 *
 * `../../parity/cases.json` holds the shared golden values. Its Python twin is
 * `sdk-py/tests/test_parity.py`, reading the same file and asserting the same
 * way, so a drift in either language fails that language's own CI job — which
 * matters because no CI job has both runtimes installed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runUsceChecks } from '../src/cards/usce.js';
import { runHypothesisChecks } from '../src/cards/checks.js';
import { runConvergenceCheck } from '../src/cards/convergence.js';
import { runSeriesChecks } from '../src/cards/series.js';
import { runAgreementChecks } from '../src/cards/agreement.js';

interface ParityCase {
  id: string;
  fn: 'usce' | 'hypothesis' | 'agreement';
  input: Record<string, any>;
  expected: Record<string, any>;
}

const fixture = JSON.parse(
  readFileSync(new URL('../../parity/cases.json', import.meta.url), 'utf8'),
) as { cases: ParityCase[]; shared: Record<string, any> };

/** Cases share fixture cards by reference (`{"$use": "..."}`) so the same card
 *  cannot drift between cases. */
function resolve(value: any): any {
  return value && typeof value === 'object' && '$use' in value ? fixture.shared[value.$use] : value;
}

function run(c: ParityCase): unknown {
  const i = c.input;
  switch (c.fn) {
    case 'usce':
      return runUsceChecks(i.output, resolve(i.card), i.requireChecks ?? false);
    case 'hypothesis':
      return runHypothesisChecks(resolve(i.card), { corpus: i.corpus ?? [] });
    case 'agreement':
      return runAgreementChecks(i.outputs, resolve(i.card));
    case 'convergence':
      return runConvergenceCheck(i.points, resolve(i.card));
    case 'series':
      return runSeriesChecks(i.series, resolve(i.card), i.conditions);
    default:
      throw new Error(`unknown fn: ${c.fn}`);
  }
}

for (const c of fixture.cases) {
  test(`parity: ${c.id}`, () => {
    let actual: unknown;
    try {
      actual = run(c);
    } catch (err) {
      // A refusal is part of the contract, so its message is pinned too.
      actual = { threw: (err as Error).message };
    }
    assert.deepEqual(
      JSON.parse(JSON.stringify(actual)),
      c.expected,
      `TypeScript output diverged from the golden value for "${c.id}". If this ` +
        `wording change is intentional, regenerate per parity/README.md — from ` +
        `BOTH languages, never one.`,
    );
  });
}

// Every cross-language entry point must appear in the fixture. This guard is
// why adding `convergence` could not silently ship unparitied: it failed here
// before it had cases, rather than after someone noticed a drift downstream.
test('parity: the fixture actually covers every engine entry point', () => {
  const covered = new Set(fixture.cases.map((c) => c.fn));
  assert.deepEqual([...covered].sort(), ['agreement', 'convergence', 'hypothesis', 'series', 'usce']);
});
