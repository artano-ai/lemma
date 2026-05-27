#!/usr/bin/env node
/**
 * n-sweep-analysis.mjs
 *
 * Given a best-of-N rerank result with N_max samples per prompt,
 * computes counterfactual policy aggregates for every N <= N_max
 * by sub-sampling the first N candidates of each prompt. This lets
 * one N=50 run answer the whole N-sweep question (N ∈ {3, 5, 10, 20,
 * 50}, or any other subset) without re-running the language model.
 *
 * Policies replayed at each N:
 *   - single_shot:        candidate 0
 *   - random:             deterministic seeded pick of one of the first N
 *   - functional_oracle:  argmax functional pass-rate over first N
 *   - lemma_rerank_full:  argmax overall_score over first N
 *   - lemma_rerank_honest: argmax verification-only score over first N
 *
 * Output:
 *   results/n-sweep-analysis-<ts>.json   — per-N + per-tier aggregates
 *   stdout                               — human-readable sweep table
 *
 * Usage:
 *   node scripts/n-sweep-analysis.mjs <best-of-n-rerank.json> [--ns "3,5,10,20,50"]
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , inputPath, ...flags] = process.argv;
if (!inputPath) {
  console.error('Usage: n-sweep-analysis.mjs <best-of-n-rerank.json> [--ns "3,5,10,20,50"]');
  process.exit(1);
}

const nsIdx = flags.indexOf('--ns');
const NS = nsIdx >= 0
  ? flags[nsIdx + 1].split(',').map((s) => parseInt(s.trim(), 10))
  : [3, 5, 10, 20, 50];

// Tier 2/3 prompt ids (mirrors the harness landmarks).
const T23 = new Set([
  'gas-rms-vs-mean-vs-most-probable-py', 'damped-oscillator-q-factor-py',
  'gauss-flux-off-center-sphere-py', 'coulomb-3body-equilibrium-py',
  'boltzmann-entropy-mixing-py', 'fermi-energy-3d-free-electron-py',
  'bloch-cosine-band-group-velocity-py', 'lda-exchange-energy-uniform-py',
  'nernst-half-cell-temperature-py', 'henderson-buffer-capacity-py',
  'eyring-vs-arrhenius-py', 'michaelis-menten-lineweaver-burk-py',
  'lotka-volterra-small-amplitude-period-py',
  'stefan-boltzmann-earth-temperature-py',
  'co2-radiative-forcing-doubling-py', 'reynolds-pipe-transition-diameter-py',
  'rk4-vs-euler-convergence-order-py', 'cfl-1d-advection-max-dt-py',
  'richardson-2nd-derivative-py', 'cauchy-schwarz-tightness-py',
  'lindhard-static-1d-py', 'arrhenius-half-life-temperature-py',
  'hardy-weinberg-chi-square-py',
]);

const run = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
const N_max = run.n_samples;

// Sanity: ensure all requested N values fit in the sample budget.
const usable = NS.filter((n) => n >= 1 && n <= N_max);
if (usable.length === 0) {
  console.error(`No requested N values fit in the sample budget N_max=${N_max}`);
  process.exit(1);
}
if (usable.length < NS.length) {
  const dropped = NS.filter((n) => !usable.includes(n));
  console.warn(`Dropping N values exceeding sample budget (${N_max}): ${dropped.join(', ')}`);
}

const hashString = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};
const argmax = (arr, key) => {
  let best = 0, bestK = key(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    const k = key(arr[i]);
    if (k > bestK) { best = i; bestK = k; }
  }
  return best;
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Map severity verdict → deployable rerank-honest score.
function severityScore(sev) {
  const penalty = { NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 }[sev] ?? 1.0;
  return 1 - penalty;
}

function policiesAt(prompt, N) {
  const samples = prompt.samples.slice(0, N);
  const single = { idx: 0, score: samples[0].overall_score };
  const randomIdx = hashString(prompt.prompt_id) % N;
  const random = { idx: randomIdx, score: samples[randomIdx].overall_score };
  const oracleIdx = argmax(samples, (s) => s.functional.pass_rate);
  const oracle = { idx: oracleIdx, score: samples[oracleIdx].overall_score };
  const fullIdx = argmax(samples, (s) => s.overall_score);
  const full = { idx: fullIdx, score: samples[fullIdx].overall_score };
  const honestIdx = argmax(samples, (s) => severityScore(s.verification.severity));
  const honest = { idx: honestIdx, score: samples[honestIdx].overall_score };
  return { single, random, oracle, full, honest };
}

const sweepResults = [];
for (const N of usable) {
  const allPrompts = run.per_prompt.map((p) => policiesAt(p, N));
  const t1 = run.per_prompt
    .filter((p) => !T23.has(p.prompt_id))
    .map((p) => policiesAt(p, N));
  const t23 = run.per_prompt
    .filter((p) => T23.has(p.prompt_id))
    .map((p) => policiesAt(p, N));

  const subset = (rows, k) => mean(rows.map((r) => r[k].score));
  const agreement = (rows, k, ref = 'oracle') =>
    rows.filter((r) => r[k].idx === r[ref].idx).length / rows.length;

  sweepResults.push({
    N,
    all: {
      n_prompts: allPrompts.length,
      single_shot: subset(allPrompts, 'single'),
      random: subset(allPrompts, 'random'),
      functional_oracle: subset(allPrompts, 'oracle'),
      lemma_rerank_full: subset(allPrompts, 'full'),
      lemma_rerank_honest: subset(allPrompts, 'honest'),
      agreement_full: agreement(allPrompts, 'full'),
      agreement_honest: agreement(allPrompts, 'honest'),
    },
    tier_1: {
      n_prompts: t1.length,
      single_shot: subset(t1, 'single'),
      functional_oracle: subset(t1, 'oracle'),
      lemma_rerank_honest: subset(t1, 'honest'),
      agreement_honest: agreement(t1, 'honest'),
    },
    tier_2_3: {
      n_prompts: t23.length,
      single_shot: subset(t23, 'single'),
      functional_oracle: subset(t23, 'oracle'),
      lemma_rerank_honest: subset(t23, 'honest'),
      agreement_honest: agreement(t23, 'honest'),
    },
  });
}

// --- Print human-readable summary ---
const M = run.model ?? 'unknown';
console.log(`\n=== N-sweep analysis: ${M} (source N_max = ${N_max}) ===\n`);

console.log('All-prompt aggregate (single_shot, oracle, lemma_honest, agreement):');
console.log(`  N     single   oracle   lemma_h  agreement_h`);
for (const r of sweepResults) {
  console.log(
    `  ${String(r.N).padStart(2)}    ${r.all.single_shot.toFixed(3)}    ${r.all.functional_oracle.toFixed(3)}    ${r.all.lemma_rerank_honest.toFixed(3)}    ${(r.all.agreement_honest * 100).toFixed(1)}%`,
  );
}

console.log('\nTier 1 only (n=50):');
console.log(`  N     single   oracle   lemma_h  agreement_h`);
for (const r of sweepResults) {
  console.log(
    `  ${String(r.N).padStart(2)}    ${r.tier_1.single_shot.toFixed(3)}    ${r.tier_1.functional_oracle.toFixed(3)}    ${r.tier_1.lemma_rerank_honest.toFixed(3)}    ${(r.tier_1.agreement_honest * 100).toFixed(1)}%`,
  );
}

console.log('\nTier 2/3 only (n=23):');
console.log(`  N     single   oracle   lemma_h  agreement_h`);
for (const r of sweepResults) {
  console.log(
    `  ${String(r.N).padStart(2)}    ${r.tier_2_3.single_shot.toFixed(3)}    ${r.tier_2_3.functional_oracle.toFixed(3)}    ${r.tier_2_3.lemma_rerank_honest.toFixed(3)}    ${(r.tier_2_3.agreement_honest * 100).toFixed(1)}%`,
  );
}

console.log('\nLift (Δ vs single_shot):');
console.log(`  N     Δ_oracle  Δ_lemma_h  fraction_captured`);
for (const r of sweepResults) {
  const dO = r.all.functional_oracle - r.all.single_shot;
  const dH = r.all.lemma_rerank_honest - r.all.single_shot;
  const frac = dO > 1e-9 ? dH / dO : NaN;
  console.log(
    `  ${String(r.N).padStart(2)}    ${dO.toFixed(3)}     ${dH.toFixed(3)}      ${isNaN(frac) ? '   ---' : (frac * 100).toFixed(1).padStart(5) + '%'}`,
  );
}

// Save the full sweep result as JSON
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = `results/n-sweep-analysis-${ts}.json`;
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  run_started_at: ts,
  source_landmark: path.basename(inputPath),
  source_model: M,
  source_N_max: N_max,
  N_sweep: usable,
  results: sweepResults,
}, null, 2));

console.log(`\nFull analysis written to ${outPath}`);
