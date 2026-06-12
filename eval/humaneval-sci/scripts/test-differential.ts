// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Sanity check for the differential scorer.
 *
 * Loads stefan-boltzmann-equilibrium-py, then runs scoreVerification
 * against three candidate variants:
 *
 *   1. correct       — the reference solution verbatim
 *   2. sigma×10      — Stefan-Boltzmann constant inflated by 10×
 *   3. sign flip     — (1 - albedo) flipped to (1 + albedo)
 *
 * Expected behavior:
 *   correct   → differential severity NONE (matches reference on probes)
 *   sigma×10  → differential severity HIGH (every probe diverges)
 *   sign flip → differential severity HIGH or MEDIUM (most probes diverge)
 *
 * If this script shows NONE for all three, the differential check is
 * not actually firing.
 */
import fs from 'node:fs';
import path from 'node:path';

import { scoreVerification } from '../scorer/verification.js';
import type { PromptDefinition } from '../scorer/types.js';
import { promptsDir as resolvePromptsDir } from '../runner/paths.js';

const promptPath = path.resolve(resolvePromptsDir(), 'stefan-boltzmann-equilibrium-py.json');
const prompt: PromptDefinition = JSON.parse(fs.readFileSync(promptPath, 'utf-8'));

const correct = prompt.reference_solution;
const brokenSigma = correct.replace('5.670374419e-8', '5.670374419e-7');
const brokenSign = correct.replace('(1.0 - albedo)', '(1.0 + albedo)');

console.log('\n=== Differential scorer sanity check ===\n');

for (const [label, code] of [
  ['correct ', correct],
  ['sigma×10', brokenSigma],
  ['sign flip', brokenSign],
] as const) {
  const verdict = await scoreVerification(prompt, code);
  const summary = verdict.details.find((d) => d.name === 'differential.summary');
  console.log(
    `${label}  severity=${verdict.severity.padEnd(6)}  ${summary?.detail ?? '(no differential)'}`,
  );
}
console.log('');
