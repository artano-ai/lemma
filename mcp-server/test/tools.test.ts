// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { agreementCheckTool } from '../src/tools/agreement-check.js';
import { cardsGetTool } from '../src/tools/cards-get.js';
import { cardsListTool } from '../src/tools/cards-list.js';
import { convergenceCheckTool } from '../src/tools/convergence-check.js';
import { hypothesisCrosscheckTool } from '../src/tools/hypothesis-crosscheck.js';
import { opsGetTool } from '../src/tools/ops-get.js';
import { seriesCheckTool } from '../src/tools/series-check.js';
import { usceCheckTool } from '../src/tools/usce-check.js';

// rag_lookup is intentionally not unit-tested: it needs a Postgres + pgvector
// backend and an embedding model, so it is exercised in integration, not here.

test('the registered tool set is exactly what is documented', async () => {
  // Pinned because the count is load-bearing *outside* this package: the
  // platform paper's supplement tabulates the v0.1.0 tools, and both READMEs
  // and the docs site enumerate them. Adding a tool without updating those
  // leaves a published document describing a surface that no longer matches.
  // Growth is fine; silent growth is not.
  const { TOOLS } = await import('../src/tools/registry.js');
  assert.deepEqual(
    TOOLS.map((t) => t.name).sort(),
    [
      'agreement_check',
      'cards_get',
      'cards_list',
      'convergence_check',
      'hypothesis_crosscheck',
      'ops_get',
      'rag_lookup',
      'series_check',
      'usce_check',
    ],
    'update the READMEs and docs/learn/the-mcp-server.md alongside this list',
  );
});

test('every registered tool declares a name, description and input schema', async () => {
  const { TOOLS } = await import('../src/tools/registry.js');
  for (const tool of TOOLS) {
    assert.ok(tool.name, 'tool has a name');
    assert.ok(
      tool.description && tool.description.length > 40,
      `${tool.name} needs a description a model can act on`,
    );
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} inputSchema`);
  }
});

// --- the three checkers promoted to tools after v0.1.0 ----------------------
// The platform paper's "six tools" statements are all scoped to the archived
// v0.1.0 release, so they stay true of that artifact — the same way its
// "38 cards" stays true while the live corpus holds more.

test('series_check reaches a card that deliberately has no envelopes', async () => {
  // density-of-states declares no validationEnvelopes: its magnitude has no
  // system-independent range. Its sign does, and that is what this checks.
  const out = await seriesCheckTool.run({
    id: 'density-of-states',
    series: { epsilon: [-1, 0, 1], g: [0.0, 1.2, 0.4] },
  });
  assert.match(out, /severity NONE/);
  assert.match(out, /g >= 0 holds/);
});

test('series_check fails on a negative density of states', async () => {
  const out = await seriesCheckTool.run({
    id: 'density-of-states',
    series: { epsilon: [-1, 0, 1], g: [0.0, -1.2, 0.4] },
  });
  assert.match(out, /severity HIGH/);
});

test('series_check refuses a non-numeric series rather than coercing it', async () => {
  await assert.rejects(
    () => seriesCheckTool.run({ id: 'density-of-states', series: { g: ['1', '2'] } }),
    /must be an array of numbers/,
  );
});

test('convergence_check recomputes the order from the study', async () => {
  const out = await convergenceCheckTool.run({
    id: 'runge-kutta-4',
    refinement: [
      [0.1, 1e-7],
      [0.05, 6.25e-9],
      [0.025, 3.90625e-10],
    ],
  });
  assert.match(out, /Observed convergence order 4 is within/);
});

test('convergence_check refuses a malformed refinement study', async () => {
  await assert.rejects(
    () => convergenceCheckTool.run({ id: 'runge-kutta-4', refinement: 'not pairs' }),
    /array of \[h, error\] pairs/,
  );
});

test('agreement_check compares two methods against the card tolerance', async () => {
  const out = await agreementCheckTool.run({
    id: 'cross-method-reproducibility',
    outputs: {
      'method-a': { latticeConstant_A: 5.47 },
      'method-b': { latticeConstant_A: 5.475 },
    },
  });
  assert.match(out, /severity NONE/);
});

test('agreement_check rejects a single method — it cannot corroborate itself', async () => {
  await assert.rejects(
    () =>
      agreementCheckTool.run({
        id: 'cross-method-reproducibility',
        outputs: { only: { latticeConstant_A: 5.47 } },
      }),
    /cannot corroborate itself/,
  );
});

test('every check tool refuses an unknown card id rather than inventing one', async () => {
  for (const tool of [seriesCheckTool, convergenceCheckTool, agreementCheckTool]) {
    await assert.rejects(
      () => tool.run({ id: 'no-such-card', series: {}, refinement: [], outputs: {} }),
      /No principle card with id/,
      `${tool.name} should refuse an unknown id`,
    );
  }
});

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
