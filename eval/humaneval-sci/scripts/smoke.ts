// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Smoke test: run the reference adapter against every prompt in
 * prompts/, score with the real cross-check engine, print a verdict
 * summary. Useful for catching engine / loader / prompt-shape
 * regressions without spending model API budget.
 *
 * Usage:
 *   pnpm smoke
 */
import path from 'node:path';

import { referenceAdapter, runEvaluation } from '../runner/runner.js';
import { promptsDir as resolvePromptsDir, resultsDir } from '../runner/paths.js';

const promptsDir = resolvePromptsDir();
const outputFile = path.resolve(resultsDir, 'smoke-latest.json');

const result = await runEvaluation({
  promptsDir,
  outputFile,
  adapter: referenceAdapter,
  skeletonMode: false,
});

console.log('\n=== HumanEval-Sci smoke run ===');
console.log(`Model:    ${result.model_id}`);
console.log(`Started:  ${result.run_started_at}`);
console.log(`Prompts:  ${result.prompts_evaluated}\n`);
for (const score of result.per_prompt) {
  const v = score.verification;
  const f = score.functional;
  console.log(
    `[${score.prompt_id}]\n` +
      `  cards:        ${score.card_ids.join(', ') || '(none)'}\n` +
      `  functional:   ${f.passed}/${f.total} pass (rate=${f.pass_rate.toFixed(2)})\n` +
      `  verification: ${v.passing}/${v.total} engine checks pass · severity ${v.severity}\n` +
      `  overall:      ${score.overall_score.toFixed(3)}`,
  );
  for (const d of v.details) {
    const mark = d.severity === 'NONE' ? '✓' : d.severity === 'LOW' ? '!' : '✗';
    console.log(`    [${mark}] ${d.name} — ${d.detail.slice(0, 100)}${d.detail.length > 100 ? '…' : ''}`);
  }
  console.log('');
}
console.log(`Aggregate:`);
console.log(
  `  mean functional pass-rate: ${result.aggregate.mean_functional_pass_rate.toFixed(3)}`,
);
console.log(
  `  mean overall score:        ${result.aggregate.mean_overall_score.toFixed(3)}`,
);
console.log(
  `  severity distribution:     ${JSON.stringify(result.aggregate.severity_distribution)}`,
);
console.log(`\nResults written to: ${outputFile}`);
