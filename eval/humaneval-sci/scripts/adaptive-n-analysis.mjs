#!/usr/bin/env node
/**
 * adaptive-n-analysis.mjs
 *
 * Replays the adaptive-N rerank policy on a best-of-N landmark.
 *
 * Policy: sample candidates one at a time; stop as soon as the
 * verifier's score (severity-derived) crosses threshold τ, or at
 * N_max. Return argmax_v of the candidates seen so far.
 *
 * Since the landmark contains all N candidates per prompt with their
 * verifier scores, we can replay this stopping rule counterfactually
 * without rerunning the language model.
 *
 * Reports per (τ, N_max):
 *   - mean expected cost (inference calls per prompt)
 *   - mean overall score under adaptive-N
 *   - oracle agreement (vs functional_oracle on the first N_max samples)
 *   - comparison to fixed-N at the same expected cost
 *
 * Usage:
 *   node scripts/adaptive-n-analysis.mjs <best-of-n-rerank.json> \
 *     [--taus "0.5,0.75,1.0"] [--n-max 20]
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, ...flags] = process.argv;
if (!inputPath) {
  console.error('Usage: adaptive-n-analysis.mjs <best-of-n-rerank.json> [--taus "0.5,0.75,1.0"] [--n-max 20]');
  process.exit(1);
}

const tausIdx = flags.indexOf('--taus');
const TAUS = tausIdx >= 0
  ? flags[tausIdx + 1].split(',').map((s) => parseFloat(s.trim()))
  : [0.5, 0.75, 1.0];
const nmaxIdx = flags.indexOf('--n-max');
const N_MAX = nmaxIdx >= 0 ? parseInt(flags[nmaxIdx + 1], 10) : 20;

const run = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const N_AVAILABLE = run.n_samples;
if (N_MAX > N_AVAILABLE) {
  console.error(`N_max=${N_MAX} exceeds available samples (${N_AVAILABLE}).`);
  process.exit(1);
}

function severityScore(sev) {
  const penalty = { NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 }[sev] ?? 1.0;
  return 1 - penalty;
}

const argmax = (arr, key) => {
  let best = 0, bestK = key(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    const k = key(arr[i]);
    if (k > bestK) { best = i; bestK = k; }
  }
  return best;
};

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// For each prompt, replay adaptive-N with each (τ, N_max).
function replayPrompt(prompt, tau, nMax) {
  const samples = prompt.samples.slice(0, nMax);
  let cost = 1;
  for (let i = 0; i < nMax; i++) {
    cost = i + 1;
    const v = severityScore(samples[i].verification.severity);
    if (v >= tau) break;
  }
  // Best of candidates seen so far (cost candidates)
  const seen = samples.slice(0, cost);
  const pickedIdx = argmax(seen, (s) => severityScore(s.verification.severity));
  // Oracle picks among ALL nMax samples (it has clairvoyance about future ones too)
  const oracleIdx = argmax(samples, (s) => s.functional.pass_rate);
  return {
    cost,
    picked_score: seen[pickedIdx].overall_score,
    picked_global_idx: pickedIdx, // index within "seen", not within full N samples
    oracle_score: samples[oracleIdx].overall_score,
    oracle_global_idx: oracleIdx,
    agrees_with_oracle: pickedIdx === oracleIdx,
  };
}

console.log(`\n=== Adaptive-N analysis: ${run.model} (source N_max = ${N_AVAILABLE}) ===`);
console.log(`N_max for adaptive policy: ${N_MAX}\n`);

console.log('Mean expected cost (inference calls/prompt) and mean overall score:');
console.log('  τ      cost   score   agreement   vs fixed-N (cost-equal)');

const results = [];
for (const tau of TAUS) {
  const rows = run.per_prompt.map((p) => replayPrompt(p, tau, N_MAX));
  const meanCost = mean(rows.map((r) => r.cost));
  const meanScore = mean(rows.map((r) => r.picked_score));
  const agreement = rows.filter((r) => r.agrees_with_oracle).length / rows.length;

  // Cost-equal fixed-N comparison: round meanCost to nearest int, get fixed-N score at that N
  const equivalentN = Math.max(1, Math.round(meanCost));
  const fixedNRows = run.per_prompt.map((p) => {
    const samples = p.samples.slice(0, equivalentN);
    const idx = argmax(samples, (s) => severityScore(s.verification.severity));
    return samples[idx].overall_score;
  });
  const fixedNScore = mean(fixedNRows);

  console.log(
    `  ${tau.toFixed(2)}   ${meanCost.toFixed(2)}   ${meanScore.toFixed(3)}    ${(agreement * 100).toFixed(1)}%       N=${equivalentN}: ${fixedNScore.toFixed(3)}`,
  );

  results.push({
    tau,
    mean_cost: meanCost,
    mean_score: meanScore,
    oracle_agreement: agreement,
    cost_equivalent_fixedN: equivalentN,
    cost_equivalent_fixedN_score: fixedNScore,
  });
}

// Also report fixed-N N_max for reference
console.log(`\nReference: fixed-N N_max = ${N_MAX}`);
const fixedFullRows = run.per_prompt.map((p) => {
  const samples = p.samples.slice(0, N_MAX);
  const idx = argmax(samples, (s) => severityScore(s.verification.severity));
  return samples[idx].overall_score;
});
const fixedFullScore = mean(fixedFullRows);
console.log(`  fixed-N=${N_MAX}: cost=${N_MAX}.00  score=${fixedFullScore.toFixed(3)}`);
console.log(`  single_shot:   cost=1.00    score=${mean(run.per_prompt.map((p) => p.samples[0].overall_score)).toFixed(3)}`);

// Save the full analysis
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = `results/adaptive-n-analysis-${ts}.json`;
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  run_started_at: ts,
  source_landmark: path.basename(inputPath),
  source_model: run.model,
  source_N_available: N_AVAILABLE,
  N_max: N_MAX,
  taus: TAUS,
  results,
}, null, 2));

console.log(`\nFull analysis written to ${outPath}`);
