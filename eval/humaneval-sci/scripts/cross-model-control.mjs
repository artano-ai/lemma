// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.
//
// CONTROL for cross-model reranking: does the gain come from DIVERSITY, or
// merely from having 15 candidates instead of 5?
//
// Pooling three families gives 15 candidates; the best single model was
// measured at 5. More candidates alone should help, so comparing 15-vs-5 does
// not isolate the thing being claimed. This holds N fixed at 5 and varies only
// whether those 5 come from one family or three.
//
// Deterministic selection (no RNG): candidates are taken round-robin across
// families, so "mixed-5" is 2 llama + 2 mistral + 1 qwen for every prompt.
import fs from 'node:fs';
const PEN = { UNCHECKED: 0, NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 };
const rr = (c) => 1 - (PEN[c.verification.severity] ?? 1);
const truth = (c) => c.overall_score;

const models = process.argv.slice(2).map((f) => {
  const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const m = new Map();
  for (const s of d.arms.samples ?? []) {
    if (!m.has(s.prompt_id)) m.set(s.prompt_id, []);
    m.get(s.prompt_id).push(s);
  }
  return { name: d.source_model, byPrompt: m };
});
const ids = [...models[0].byPrompt.keys()].filter((id) =>
  models.every((m) => m.byPrompt.has(id)));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
function pick(c) { let b = 0; for (let i = 1; i < c.length; i++) if (rr(c[i]) > rr(c[b])) b = i; return c[b]; }

function evalPool(per, label) {
  const rerank = [], oracle = []; let agree = 0, flat = 0;
  for (const id of ids) {
    const c = per(id);
    const t = c.map(truth), best = Math.max(...t);
    const ch = pick(c);
    rerank.push(truth(ch)); oracle.push(best);
    if (truth(ch) === best) agree++;
    if (new Set(t).size === 1) flat++;
  }
  return { label, n: per(ids[0]).length, rerank: mean(rerank), oracle: mean(oracle),
           agree: agree / ids.length, flat: flat / ids.length };
}

// Round-robin 5 across families: llama, mistral, qwen, llama, mistral.
const mixed5 = (id) => {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const m = models[i % models.length];
    out.push(m.byPrompt.get(id)[Math.floor(i / models.length)]);
  }
  return out;
};

const rows = [
  ...models.map((m) => evalPool((id) => m.byPrompt.get(id), `${m.name} (own 5)`)),
  evalPool(mixed5, 'MIXED 5 (2+2+1)'),
  evalPool((id) => models.flatMap((m) => m.byPrompt.get(id)), 'POOLED 15'),
];
console.log('\ncontrol: diversity vs candidate count · N held fixed at 5\n');
console.log(`  ${'pool'.padEnd(24)}${'N'.padStart(3)}${'rerank'.padStart(9)}${'oracle'.padStart(9)}${'agree'.padStart(8)}${'flat'.padStart(7)}`);
for (const r of rows)
  console.log(`  ${r.label.padEnd(24)}${String(r.n).padStart(3)}${r.rerank.toFixed(3).padStart(9)}${r.oracle.toFixed(3).padStart(9)}${(r.agree*100).toFixed(1).padStart(7)}%${(r.flat*100).toFixed(0).padStart(6)}%`);

const bestOwn = Math.max(...rows.slice(0, models.length).map((r) => r.rerank));
const mixed = rows[models.length].rerank;
console.log(`\n  best single-family at N=5 : ${bestOwn.toFixed(3)}`);
console.log(`  mixed families at N=5     : ${mixed.toFixed(3)}`);
console.log(`  diversity effect (same N) : ${(mixed - bestOwn >= 0 ? '+' : '') + (mixed - bestOwn).toFixed(3)}`);
console.log(`  count effect (5 -> 15)    : ${(rows[models.length + 1].rerank - mixed >= 0 ? '+' : '') + (rows[models.length + 1].rerank - mixed).toFixed(3)}`);
