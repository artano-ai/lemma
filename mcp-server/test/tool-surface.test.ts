// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Tool-surface contract: the TypeScript half.
 *
 * `parity/cases.json` pins the *engine* against golden text, which works
 * because its fixture cards are synthetic. The tool surface renders the **live
 * corpus**, so golden text there would break on every card edit and train
 * whoever hits it to regenerate reflexively — the exact habit
 * `parity/README.md` warns against. So this file pins *invariants* instead,
 * and its Python twin (`sdk-py/tests/test_tool_surface.py`) asserts the same
 * ones. A drift in either language fails that language's own CI job.
 *
 * Both invariants below are regressions that actually shipped, not
 * hypotheticals — see the file header in the Python twin.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cardsListTool } from '../src/tools/cards-list.js';
import { cardsGetTool } from '../src/tools/cards-get.js';
import { opsGetTool } from '../src/tools/ops-get.js';
import { hypothesisCrosscheckTool } from '../src/tools/hypothesis-crosscheck.js';

const SAMPLES: Array<[string, () => Promise<string>]> = [
  ['cards_list', () => cardsListTool.run({})],
  ['cards_get', () => cardsGetTool.run({ id: 'ideal-gas-law' })],
  ['ops_get', () => opsGetTool.run({ id: 'slurm-marenostrum5-gpp-compute' })],
  [
    'hypothesis_crosscheck',
    () => hypothesisCrosscheckTool.run({ id: 'free-fall-with-linear-drag' }),
  ],
];

// --- authorship never reaches the model ------------------------------------
// `metadata` carries author names and ORCIDs. The tool surface is the LLM-facing
// path, so it must be stripped: sending it would leak contributor data to a model
// provider on every call, spend context on non-physics, and invite a model to
// weight a claim by the prestige of whoever curated it.

for (const [name, call] of SAMPLES) {
  test(`tool surface: ${name} does not leak card metadata`, async () => {
    const out = await call();
    assert.ok(
      !out.includes('"metadata"'),
      `${name} leaked the metadata block into LLM-facing output.`,
    );
    assert.ok(!out.includes('orcid'), `${name} leaked an ORCID into LLM-facing output.`);
  });
}

// --- the embedded JSON stays human-readable --------------------------------
// hypothesis_crosscheck embeds the raw verdict as JSON. It must render literal
// UTF-8, not escapes: a reader of the block should see the dimension symbols,
// not their code points.

test('tool surface: hypothesis_crosscheck embeds literal UTF-8, not escapes', async () => {
  const out = await hypothesisCrosscheckTool.run({ id: 'free-fall-with-linear-drag' });
  assert.ok(out.includes('```json'), 'expected an embedded raw-JSON block');
  assert.ok(!out.includes('\\u00b7'), 'dimension separator was escaped instead of literal');
  assert.ok(!out.includes('\\u2014'), 'em dash was escaped instead of literal');
  assert.ok(out.includes('·'), 'expected a literal dimension separator in the block');
});
