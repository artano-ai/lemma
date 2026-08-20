// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Pre-registered replication of the composition rule.
 * Predictions were fixed in advance of the run, so the result is read against
 * a stated expectation rather than after the fact.
 *
 * Rule under test: ANCHOR x3 + OTHER_A x1 + OTHER_B x1 (N = 5)
 * Baseline:        ANCHOR x5 (that family's own five candidates)
 *
 * Evaluated over EVERY legal draw — C(5,3) = 10 anchor triples x 5 x 5 = 250
 * per anchor, 750 total. No draw is discarded, because reporting the best draw
 * is exactly what made the original finding exploratory.
 *
 * Costs no inference: consumes re-scored archived candidates.
 */

import fs from 'node:fs';

const PENALTY = { UNCHECKED: 0, NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 };
const rerankScore = (c) => 1 - (PENALTY[c.verification.severity] ?? 1);
const truth = (c) => c.overall_score;

const models = process.argv.slice(2).map((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  if (d.kind !== 'rescore') throw new Error(`${f} is not a rescore record`);
  const byPrompt = new Map();
  for (const s of d.arms.samples ?? []) {
    if (!byPrompt.has(s.prompt_id)) byPrompt.set(s.prompt_id, []);
    byPrompt.get(s.prompt_id).push(s);
  }
  return { name: d.source_model, byPrompt, metric: d.metric_version, interp: d.interpreter };
});

if (new Set(models.map((m) => m.interp)).size > 1 ||
    new Set(models.map((m) => m.metric)).size > 1) {
  console.error('✗ inputs scored under different conditions — refusing.');
  process.exit(2);
}

const ids = [...models[0].byPrompt.keys()].filter((id) =>
  models.every((m) => m.byPrompt.has(id)));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function pick(c) {
  let b = 0;
  for (let i = 1; i < c.length; i++) if (rerankScore(c[i]) > rerankScore(c[b])) b = i;
  return c[b];
}

/** Score one fixed composition across all prompts. */
function score(compose) {
  const got = [];
  let agree = 0;
  for (const id of ids) {
    const c = compose(id);
    const t = c.map(truth);
    const chosen = pick(c);
    got.push(truth(chosen));
    if (truth(chosen) === Math.max(...t)) agree++;
  }
  return { rerank: mean(got), agreement: agree / ids.length };
}

const triples = [];
for (let a = 0; a < 5; a++)
  for (let b = a + 1; b < 5; b++)
    for (let c = b + 1; c < 5; c++) triples.push([a, b, c]);

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

console.log(`\ncomposition-rule replication · ${ids.length} prompts · metric v${models[0].metric}`);
console.log(`rule: ANCHOR x3 + OTHER x1 + OTHER x1 (N=5)   vs   ANCHOR x5\n`);

const summary = [];
for (const anchor of models) {
  const others = models.filter((m) => m !== anchor);
  const baseline = score((id) => anchor.byPrompt.get(id).slice(0, 5));

  const draws = [];
  for (const tri of triples)
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        draws.push(
          score((id) => [
            ...tri.map((k) => anchor.byPrompt.get(id)[k]),
            others[0].byPrompt.get(id)[i],
            others[1].byPrompt.get(id)[j],
          ]),
        );

  const scores = draws.map((d) => d.rerank).sort((x, y) => x - y);
  const wins = draws.filter((d) => d.rerank > baseline.rerank).length;
  const ties = draws.filter((d) => d.rerank === baseline.rerank).length;
  const agrees = draws.map((d) => d.agreement);
  // The draw the exploratory finding reported: anchor [0,1,2] + other[0] + other[0].
  const discovered = score((id) => [
    ...[0, 1, 2].map((k) => anchor.byPrompt.get(id)[k]),
    others[0].byPrompt.get(id)[0],
    others[1].byPrompt.get(id)[0],
  ]).rerank;
  const pct = scores.filter((s) => s < discovered).length / scores.length;

  summary.push({ anchor: anchor.name, baseline: baseline.rerank, mean: mean(scores),
                 min: scores[0], max: scores[scores.length - 1],
                 med: quantile(scores, 0.5), wins, ties, n: draws.length,
                 agree: mean(agrees), minAgree: Math.min(...agrees),
                 discovered, pct });

  console.log(`  anchor ${anchor.name}`);
  console.log(`    baseline (own x5)      ${baseline.rerank.toFixed(4)}   agreement ${(baseline.agreement * 100).toFixed(1)}%`);
  console.log(`    rule over ${draws.length} draws     mean ${mean(scores).toFixed(4)}  median ${quantile(scores, 0.5).toFixed(4)}  min ${scores[0].toFixed(4)}  max ${scores[scores.length - 1].toFixed(4)}`);
  console.log(`    beats baseline         ${wins}/${draws.length} (${(wins / draws.length * 100).toFixed(0)}%)   ties ${ties}`);
  console.log(`    oracle agreement       mean ${(mean(agrees) * 100).toFixed(1)}%  worst ${(Math.min(...agrees) * 100).toFixed(1)}%`);
  console.log(`    the reported draw      ${discovered.toFixed(4)}  = ${(pct * 100).toFixed(0)}th percentile\n`);
}

const q = summary.find((s) => s.baseline === Math.max(...summary.map((x) => x.baseline)));
const verdict = (ok) => (ok ? 'MET    ' : 'NOT MET');
console.log('  pre-registered predictions:');
console.log(`    R1 anchor-mean > baseline        ${verdict(q.mean > q.baseline)}  (${q.mean.toFixed(4)} vs ${q.baseline.toFixed(4)}, anchor ${q.anchor})`);
console.log(`    R2 wins on > 50% of draws        ${verdict(q.wins / q.n > 0.5)}  (${(q.wins / q.n * 100).toFixed(0)}%)`);
console.log(`    R3 holds for all three anchors   ${verdict(summary.every((s) => s.mean > s.baseline))}  (${summary.filter((s) => s.mean > s.baseline).length}/3)`);
console.log(`    R4 agreement >= 95%              ${verdict(summary.every((s) => s.agree >= 0.95))}  (min mean ${(Math.min(...summary.map((s) => s.agree)) * 100).toFixed(1)}%)`);
console.log(`    R5 reported draw in top quartile ${verdict(q.pct >= 0.75)}  (${(q.pct * 100).toFixed(0)}th pct)`);
