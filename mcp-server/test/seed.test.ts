// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  OPS_CARDS,
  findHypothesisCard,
  findOpsCard,
  findPrincipleCard,
} from '../src/cards/seed.js';

test('the seed corpus loads', () => {
  assert.ok(ALL_CARDS.length >= 30, `expected >= 30 principle cards, got ${ALL_CARDS.length}`);
  assert.ok(OPS_CARDS.length >= 1);
  assert.ok(HYPOTHESIS_CARDS.length >= 1);
});

test('find functions resolve real ids', () => {
  assert.ok(findPrincipleCard('ideal-gas-law'));
  assert.ok(findOpsCard('slurm-marenostrum5-gpp-compute'));
  assert.ok(findHypothesisCard('free-fall-with-linear-drag'));
});

test('find functions return nothing for unknown ids', () => {
  assert.ok(!findPrincipleCard('does-not-exist'));
  assert.ok(!findOpsCard('does-not-exist'));
  assert.ok(!findHypothesisCard('does-not-exist'));
});

test('every card carries the basic spine', () => {
  for (const c of [...ALL_CARDS, ...OPS_CARDS, ...HYPOTHESIS_CARDS]) {
    assert.ok(c.id, 'card missing id');
    assert.ok(c.version, `card ${c.id} missing version`);
    assert.ok(c.name, `card ${c.id} missing name`);
  }
});
