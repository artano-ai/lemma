// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runAgreementChecks } from '../src/cards/agreement.js';
import type { PrincipleCard } from '../src/cards/types.js';

const card: PrincipleCard = {
  kind: 'principle',
  id: 'test-agreement',
  version: '1.0.0',
  name: 'test',
  principles: ['p'],
  formulaTeX: 'x',
  conventions: ['c'],
  expectedLimits: ['l'],
  references: ['r'],
  crossMethodTolerances: {
    latticeConstant_A: { relative: 0.01 },
    indirectGap_eV: { absolute: 0.05 },
    bulkModulus_GPa: { absolute: 25.0, gating: false },
  },
};

// The real C1 numbers: Madar 0.536 eV vs Kavosh 0.559 eV, a0 5.470 vs 5.458.
const agreeing = {
  madar: { latticeConstant_A: 5.47, indirectGap_eV: 0.536 },
  kavosh: { latticeConstant_A: 5.458, indirectGap_eV: 0.559 },
};

test('agreeing methods -> NONE', () => {
  const r = runAgreementChecks(agreeing, card);
  assert.equal(r.overall.severity, 'NONE');
  assert.equal(r.overall.total, 2);
  assert.equal(r.overall.passing, 2);
});

test('relative tolerance catches a lattice-constant disagreement', () => {
  const r = runAgreementChecks(
    { a: { latticeConstant_A: 5.4 }, b: { latticeConstant_A: 5.65 } },
    card,
  );
  assert.equal(r.overall.severity, 'HIGH');
  assert.deepEqual(
    r.checks.map((c) => c.severity),
    ['fail'],
  );
});

test('absolute tolerance catches a gap disagreement', () => {
  const r = runAgreementChecks({ a: { indirectGap_eV: 0.3 }, b: { indirectGap_eV: 0.56 } }, card);
  assert.equal(r.overall.severity, 'HIGH');
});

test('non-gating divergence warns without failing', () => {
  const r = runAgreementChecks(
    {
      madar: { latticeConstant_A: 5.47, bulkModulus_GPa: 133.0 },
      kavosh: { latticeConstant_A: 5.458, bulkModulus_GPa: 81.0 },
    },
    card,
  );
  assert.equal(r.overall.severity, 'LOW'); // visible, but the comparison stands
  const b0 = r.checks.find((c) => c.name.endsWith('bulkModulus_GPa'))!;
  assert.equal(b0.severity, 'warn');
  assert.ok(b0.detail.includes('not gating'));
});

// --- the anti-silent-pass contract ------------------------------------------
// An envelope check returns NONE when nothing overlapped, which makes "checked
// everything and agreed" indistinguishable from "checked nothing". Agreement
// must not inherit that.

test('nothing comparable is a failure, not a pass', () => {
  const r = runAgreementChecks({ a: { somethingElse: 1 }, b: { anotherThing: 2 } }, card);
  assert.equal(r.overall.severity, 'HIGH');
  assert.equal(r.overall.total, 0);
  assert.ok(r.diagnosis.includes('absent comparison'));
});

test('an observable reported by only one method is not silently dropped', () => {
  const r = runAgreementChecks(
    {
      a: { latticeConstant_A: 5.47, indirectGap_eV: 0.54 },
      b: { latticeConstant_A: 5.46 },
    },
    card,
  );
  assert.equal(r.overall.severity, 'NONE'); // the comparable one agrees
  assert.equal(r.overall.total, 1);
  assert.ok(r.diagnosis.includes('indirectGap_eV')); // the skipped one is named
});

test('a single method throws rather than reporting agreement', () => {
  assert.throws(() => runAgreementChecks({ madar: { latticeConstant_A: 5.47 } }, card), {
    message: /cannot corroborate itself/,
  });
});

test('a card without tolerances reports absence, not agreement', () => {
  const bare: PrincipleCard = { ...card, crossMethodTolerances: undefined };
  assert.equal(runAgreementChecks(agreeing, bare).overall.severity, 'HIGH');
});

test('three methods use the full spread, not pairwise', () => {
  const r = runAgreementChecks(
    {
      a: { latticeConstant_A: 5.46 },
      b: { latticeConstant_A: 5.47 },
      c: { latticeConstant_A: 5.65 }, // only a-c exceeds 1%
    },
    card,
  );
  assert.equal(r.overall.severity, 'HIGH');
});

test('the detail names every method and value', () => {
  const detail = runAgreementChecks(agreeing, card).checks[0]!.detail;
  assert.ok(detail.includes('madar='));
  assert.ok(detail.includes('kavosh='));
});
