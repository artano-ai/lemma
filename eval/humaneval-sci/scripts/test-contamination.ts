// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Sanity check for contamination filtering.
 *
 * Run: `pnpm test-contamination`
 *
 * Contamination inflates the CONTROL arm — a model that has memorised the exact
 * exercise scores well without reasoning — so a headline computed over
 * memorised tasks *under*-states the substrate's effect. The mitigation is to
 * re-run on a held-out low-contamination subset and report how much of the
 * result survives.
 *
 * The case this file exists for is the third one: a prompt with **no**
 * assessment must be dropped, never assumed clean. Assuming clean would refill
 * the held-out subset with exactly the prompts it exists to exclude, and the
 * output would look like a sensitivity analysis while being the original
 * headline under a different name.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { filterByContamination } from '../runner/ab-runner.js';
import { promptsDir } from '../runner/paths.js';
import type { PromptDefinition } from '../scorer/types.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

const make = (id: string, level?: 'low' | 'medium' | 'high'): PromptDefinition =>
  ({
    id,
    card_ids: ['x'],
    domain: 'd',
    language: 'python',
    prompt: 'p',
    reference_solution: '',
    test_cases: [],
    verification_targets: {},
    ...(level ? { contamination_risk: { level, basis: 'fixture', assessed_by: 'rubric' } } : {}),
  }) as PromptDefinition;

const SAMPLE = [make('lo', 'low'), make('med', 'medium'), make('hi', 'high'), make('none')];

console.log('contamination filtering\n');

check('no ceiling keeps everything, including unassessed', () => {
  assert.equal(filterByContamination(SAMPLE, undefined).length, 4);
});

check('a ceiling keeps that level and below', () => {
  assert.deepEqual(filterByContamination(SAMPLE, 'low').map((p) => p.id), ['lo']);
  assert.deepEqual(filterByContamination(SAMPLE, 'medium').map((p) => p.id), ['lo', 'med']);
  assert.deepEqual(filterByContamination(SAMPLE, 'high').map((p) => p.id), ['lo', 'med', 'hi']);
});

check('an unassessed prompt is dropped, never assumed clean', () => {
  for (const ceiling of ['low', 'medium', 'high'] as const) {
    assert.ok(
      !filterByContamination(SAMPLE, ceiling).some((p) => p.id === 'none'),
      `unassessed prompt leaked into the ${ceiling} subset`,
    );
  }
});

// --- against the real benchmark ---------------------------------------------

const dir = promptsDir();
const real: PromptDefinition[] = fs
  .readdirSync(dir)
  .filter((e) => e.endsWith('.json'))
  .map((e) => JSON.parse(fs.readFileSync(path.join(dir, e), 'utf-8')));

check('every shipped prompt carries an assessment with a stated basis', () => {
  for (const p of real) {
    assert.ok(p.contamination_risk, `${p.id} has no contamination_risk`);
    assert.ok(
      p.contamination_risk!.basis.length > 20,
      `${p.id} states no basis — a bare level cannot be reviewed or disagreed with`,
    );
  }
});

check('the benchmark currently has no low-contamination subset to hold out', () => {
  // Not a bug in this code — a fact about the prompt set, and the reason the
  // sensitivity analysis doc 11 asks for cannot be run yet. Every prompt cites
  // exactly one card, so all 73 are single-law tasks and 66 are the forward
  // (most-memorised) form. This assertion is a tripwire: when authoring adds
  // composed prompts it will fail, which is the signal that the analysis has
  // become possible.
  assert.equal(filterByContamination(real, 'low').length, 0);
  assert.ok(filterByContamination(real, 'medium').length < 10);
});

console.log(`\n${passed} checks passed`);
