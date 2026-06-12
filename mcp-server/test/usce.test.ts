// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runUsceChecks } from '../src/cards/usce.js';

const card = {
  kind: 'principle',
  id: 't',
  version: '1.0.0',
  name: 'test',
  principles: [],
  formulaTeX: 'x',
  conventions: [],
  expectedLimits: [],
  references: [],
  validationEnvelopes: { gasConstant_J_per_molK: [8.314, 8.315] as [number, number] },
} as const;

test('value within the envelope -> pass / NONE', () => {
  const r = runUsceChecks({ gasConstant_J_per_molK: 8.3145 }, card);
  assert.equal(r.overall.severity, 'NONE');
  assert.equal(r.checks[0]!.severity, 'pass');
});

test('value outside the envelope -> fail / HIGH', () => {
  const r = runUsceChecks({ gasConstant_J_per_molK: 9.0 }, card);
  assert.equal(r.overall.severity, 'HIGH');
  assert.equal(r.checks[0]!.severity, 'fail');
});

test('no overlapping keys -> nothing checked / NONE', () => {
  const r = runUsceChecks({ unrelated: 1 }, card);
  assert.equal(r.overall.total, 0);
  assert.equal(r.overall.severity, 'NONE');
});
