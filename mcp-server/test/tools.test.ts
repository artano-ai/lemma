// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardsGetTool } from '../src/tools/cards-get.js';
import { cardsListTool } from '../src/tools/cards-list.js';
import { hypothesisCrosscheckTool } from '../src/tools/hypothesis-crosscheck.js';
import { opsGetTool } from '../src/tools/ops-get.js';
import { usceCheckTool } from '../src/tools/usce-check.js';

// rag_lookup is intentionally not unit-tested: it needs a Postgres + pgvector
// backend and an embedding model, so it is exercised in integration, not here.

test('cards_list returns a catalogue containing a known card', async () => {
  const out = await cardsListTool.run({});
  assert.match(out, /ideal-gas-law/);
});

test('cards_list filters by domain', async () => {
  const out = await cardsListTool.run({ domain: 'chemistry' });
  assert.match(out, /chemistry/);
});

test('cards_get returns the full record by id', async () => {
  const out = await cardsGetTool.run({ id: 'ideal-gas-law' });
  assert.match(out, /"id": "ideal-gas-law"/);
});

test('cards_get refuses to fabricate an unknown id', async () => {
  await assert.rejects(() => cardsGetTool.run({ id: 'no-such-card' }));
});

test('ops_get renders an ops card', async () => {
  const out = await opsGetTool.run({ id: 'slurm-marenostrum5-gpp-compute' });
  assert.match(out, /slurm-marenostrum5-gpp-compute/);
});

test('ops_get rejects an unknown id', async () => {
  await assert.rejects(() => opsGetTool.run({ id: 'no-such-ops' }));
});

test('hypothesis_crosscheck runs on a corpus card', async () => {
  const out = await hypothesisCrosscheckTool.run({ id: 'free-fall-with-linear-drag' });
  assert.match(out, /dimensional/i);
});

test('usce_check passes a value inside the envelope', async () => {
  const out = await usceCheckTool.run({
    id: 'ideal-gas-law',
    output: { gasConstant_J_per_molK: 8.3145 },
  });
  assert.match(out, /NONE/);
});

test('usce_check flags a value outside the envelope', async () => {
  const out = await usceCheckTool.run({
    id: 'ideal-gas-law',
    output: { gasConstant_J_per_molK: 9.0 },
  });
  assert.match(out, /HIGH/);
});

test('usce_check rejects an unknown card id', async () => {
  await assert.rejects(() => usceCheckTool.run({ id: 'no-such-card', output: {} }));
});
