// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.
//
// Higher-powered rerun of the ONE comparison that matters from 53-:
// does the verifier's diagnosis beat a blind retry?
//
// The first run resolved it on 4 discordant prompts out of 73 (p = 0.625).
// This holds the first sample FIXED per prompt and varies only the
// second-attempt prompt, REPS times each. Fixing the first sample removes the
// largest noise source, so any difference is attributable to the prompt
// content alone - which is exactly the claim under test.
import fs from 'node:fs';
import path from 'node:path';
import { scoreFunctional } from '../scorer/functional.js';
import { scoreVerification, combine } from '../scorer/verification.js';
import { promptsDir, resultsDir, pythonBin } from '../runner/paths.js';
import { SYSTEM_CONTROL } from '../runner/adapters/ollama.js';
import type { PromptDefinition, VerificationScore } from '../scorer/types.js';

const MODEL = process.argv[2] ?? 'qwen2.5:7b';
const REPS = Number(process.argv[3] ?? 5);
const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

async function gen(messages: Array<{ role: string; content: string }>) {
  const r = await fetch(`${HOST}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, stream: false, options: { temperature: 0.7 } }),
  });
  const j = (await r.json()) as { message?: { content?: string } };
  const s = j.message?.content ?? '';
  const m = s.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  return (m ? m[1]! : s).trim();
}
const sys = { role: 'system', content: SYSTEM_CONTROL };
const diag = (v: VerificationScore) =>
  v.details.filter((d) => d.severity !== 'NONE' && d.severity !== 'UNCHECKED')
    .map((d) => `- ${d.name}: ${d.detail}`).join('\n');

async function score(p: PromptDefinition, code: string) {
  return combine(p, await scoreFunctional(p, code), await scoreVerification(p, code));
}

const prev = JSON.parse(fs.readFileSync(path.join(resultsDir, `repair-${MODEL.replace(/[:.]/g, '')}.json`), 'utf-8'));
const flaggedIds = new Set(prev.rows.filter((r: {flagged: boolean}) => r.flagged).map((r: {prompt_id: string}) => r.prompt_id));
const prompts: PromptDefinition[] = fs.readdirSync(promptsDir()).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(promptsDir(), f), 'utf-8')))
  .filter((p: PromptDefinition) => flaggedIds.has(p.id));

console.log(`repair power · ${MODEL} · ${prompts.length} flagged prompts · ${REPS} reps/arm\n`);
const rows: Array<Record<string, unknown>> = [];
for (const p of prompts) {
  // Regenerate a first sample until the verifier flags it, so repair has something to act on.
  let first = '', fv: VerificationScore | null = null;
  for (let k = 0; k < 4; k++) {
    first = await gen([sys, { role: 'user', content: p.prompt }]);
    fv = await scoreVerification(p, first);
    if (fv.severity !== 'NONE') break;
  }
  if (!fv || fv.severity === 'NONE') { console.log(`  ${p.id}: never flagged, skipped`); continue; }
  const base = (await score(p, first)).overall_score;
  const retry: number[] = [], repair: number[] = [];
  for (let i = 0; i < REPS; i++) {
    retry.push((await score(p, await gen([sys, { role: 'user', content: p.prompt },
      { role: 'assistant', content: first },
      { role: 'user', content: 'That answer may be incorrect. Try again.' }]))).overall_score);
    repair.push((await score(p, await gen([sys, { role: 'user', content: p.prompt },
      { role: 'assistant', content: first },
      { role: 'user', content: 'A verifier checked that answer and reported:\n' + diag(fv) +
        '\n\nFix the code so these no longer hold. Return ONLY the code.' }]))).overall_score);
  }
  const mr = retry.reduce((a, b) => a + b, 0) / REPS, mp = repair.reduce((a, b) => a + b, 0) / REPS;
  rows.push({ prompt_id: p.id, base, retry, repair, mean_retry: mr, mean_repair: mp });
  console.log(`  ${p.id.slice(0, 38).padEnd(38)} base ${base.toFixed(2)}  retry ${mr.toFixed(3)}  repair ${mp.toFixed(3)}`);
}
const mean = (k: string) => rows.reduce((a, r) => a + (r[k] as number), 0) / rows.length;
console.log(`\n  n=${rows.length} prompts x ${REPS} reps`);
console.log(`  blind retry ${mean('mean_retry').toFixed(4)}`);
console.log(`  repair      ${mean('mean_repair').toFixed(4)}`);
const dif = rows.map((r) => (r.mean_repair as number) - (r.mean_retry as number));
const m = dif.reduce((a, b) => a + b, 0) / dif.length;
const sd = Math.sqrt(dif.reduce((a, b) => a + (b - m) ** 2, 0) / (dif.length - 1));
console.log(`  paired diff ${m >= 0 ? '+' : ''}${m.toFixed(4)}  t=${(m / (sd / Math.sqrt(dif.length))).toFixed(2)}`);
console.log(`  repair wins ${dif.filter((x) => x > 0).length}, retry wins ${dif.filter((x) => x < 0).length}, ties ${dif.filter((x) => x === 0).length}`);
fs.writeFileSync(path.join(resultsDir, `repair-power-${MODEL.replace(/[:.]/g, '')}.json`),
  JSON.stringify({ model: MODEL, reps: REPS, interpreter: pythonBin(), rows }, null, 2) + '\n');
