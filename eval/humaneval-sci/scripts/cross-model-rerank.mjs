// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Cross-model reranking: pool candidates from several model families and let
 * the verifier pick, on one scale, without executing tests.
 *
 * Run: node scripts/cross-model-rerank.mjs <rescored.json> [<rescored.json> ...]
 *
 * Costs no inference — it consumes re-scored archived candidates.
 *
 * **Inputs must be re-scored on ONE harness.** The archived records were
 * produced months apart under different harness states (numpy importable or
 * not), so pooling them as-archived would rank the models by when their run
 * happened rather than by what they wrote. This script refuses inputs whose
 * `metric_version` or `interpreter` disagree, because that mistake is silent
 * and produces a confident, wrong ordering.
 *
 * Predictions were recorded before this was run, so the outcome is read
 * against a stated expectation rather than after the fact.
 */

import fs from 'node:fs';
import path from 'node:path';

const PENALTY = { UNCHECKED: 0, NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 };

/** The signal a deployed router actually sees: verification only, no tests. */
const rerankScore = (c) => 1 - (PENALTY[c.verification.severity] ?? 1);
/** Ground truth, used only to grade the selector. */
const truth = (c) => c.overall_score;

const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('usage: node scripts/cross-model-rerank.mjs <a.json> <b.json> [...]');
  process.exit(2);
}

const models = [];
const seen = { metric: new Set(), interp: new Set() };

for (const f of files) {
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  if (d.kind !== 'rescore') {
    console.error(`✗ ${path.basename(f)} is not a rescore record — refusing.`);
    console.error('  Archived scores were produced under different harnesses.');
    process.exit(2);
  }
  seen.metric.add(d.metric_version);
  seen.interp.add(d.interpreter);
  const byPrompt = new Map();
  for (const s of d.arms.samples ?? []) {
    if (!byPrompt.has(s.prompt_id)) byPrompt.set(s.prompt_id, []);
    byPrompt.get(s.prompt_id).push(s);
  }
  models.push({ name: d.source_model ?? path.basename(f), byPrompt });
}

if (seen.metric.size > 1 || seen.interp.size > 1) {
  console.error('✗ inputs were scored under different conditions — refusing to pool.');
  console.error(`  metric_version: ${[...seen.metric].join(', ')}`);
  console.error(`  interpreter:    ${[...seen.interp].join('\n                  ')}`);
  process.exit(2);
}

// Prompts present in every model.
const ids = [...models[0].byPrompt.keys()].filter((id) =>
  models.every((m) => m.byPrompt.has(id)),
);

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Best-of by the verifier signal; ties broken by first-seen (no oracle peeking). */
function pick(cands) {
  let best = 0;
  for (let i = 1; i < cands.length; i++) {
    if (rerankScore(cands[i]) > rerankScore(cands[best])) best = i;
  }
  return cands[best];
}

function evaluate(label, per) {
  const single = [];
  const rerank = [];
  const oracle = [];
  let agree = 0;
  let flat = 0;
  let choice = 0;
  const gains = [];

  for (const id of ids) {
    const c = per(id);
    const t = c.map(truth);
    const best = Math.max(...t);
    single.push(t[0]);
    const chosen = pick(c);
    rerank.push(truth(chosen));
    oracle.push(best);
    if (truth(chosen) === best) agree++;
    if (new Set(t).size === 1) flat++;
    else {
      choice++;
      gains.push(truth(chosen) - mean(t));
    }
  }
  return {
    label,
    n: ids.length,
    single: mean(single),
    rerank: mean(rerank),
    oracle: mean(oracle),
    agreement: agree / ids.length,
    flat: flat / ids.length,
    choice,
    gainWhereChoice: mean(gains),
  };
}

const rows = [];
for (const m of models) {
  rows.push(evaluate(m.name, (id) => m.byPrompt.get(id)));
}
const pooled = evaluate('POOLED (all families)', (id) =>
  models.flatMap((m) => m.byPrompt.get(id)),
);

console.log(`\ncross-model reranking · ${ids.length} prompts`);
console.log(`metric v${[...seen.metric][0]} · one harness · ${models.length} families\n`);
const h = (s, w) => String(s).padEnd(w);
const n = (x, w = 8) => x.toFixed(3).padStart(w);
console.log(
  `  ${h('candidate pool', 26)}${'single'.padStart(8)}${'rerank'.padStart(8)}` +
    `${'oracle'.padStart(8)}${'agree'.padStart(8)}${'flat'.padStart(8)}${'k'.padStart(5)}`,
);
for (const r of [...rows, pooled]) {
  console.log(
    `  ${h(r.label, 26)}${n(r.single)}${n(r.rerank)}${n(r.oracle)}` +
      `${(r.agreement * 100).toFixed(1).padStart(7)}%${(r.flat * 100).toFixed(0).padStart(7)}%` +
      `${String(r.choice).padStart(5)}`,
  );
}

const bestSingle = Math.max(...rows.map((r) => r.rerank));
console.log(`\n  best single-model rerank : ${bestSingle.toFixed(3)}`);
console.log(`  pooled rerank            : ${pooled.rerank.toFixed(3)}`);
console.log(
  `  cross-model gain         : ${(pooled.rerank - bestSingle >= 0 ? '+' : '') + (pooled.rerank - bestSingle).toFixed(3)}`,
);
console.log(`  pooled headroom captured : ${((pooled.rerank - pooled.single) / (pooled.oracle - pooled.single) * 100 || 0).toFixed(1)}% of oracle lift`);
console.log(`  prompts offering a choice: ${pooled.choice}/${ids.length}`);
console.log(`  mean gain where a choice exists: ${pooled.gainWhereChoice >= 0 ? '+' : ''}${pooled.gainWhereChoice.toFixed(3)}`);

console.log('\n  pre-registered predictions:');
const verdict = (ok) => (ok ? 'MET    ' : 'NOT MET');
console.log(`    P1 pooled flat < 60%          ${verdict(pooled.flat < 0.6)}  (${(pooled.flat * 100).toFixed(0)}%)`);
console.log(`    P2 pooled rerank > best single ${verdict(pooled.rerank > bestSingle)}  (${pooled.rerank.toFixed(3)} vs ${bestSingle.toFixed(3)})`);
console.log(`    P3 agreement >= 95%           ${verdict(pooled.agreement >= 0.95)}  (${(pooled.agreement * 100).toFixed(1)}%)`);
console.log(`    P4 gain concentrates          ${verdict(pooled.gainWhereChoice > pooled.rerank - pooled.single)}`);
