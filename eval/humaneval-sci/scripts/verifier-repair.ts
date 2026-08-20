// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Does the verifier make the model write better code?
 * Predictions recorded before the run, so each arm is read against a stated
 * expectation rather than after the fact.
 *
 * Four arms, three of them at identical cost (two generations):
 *
 *   1 single       one sample
 *   2 blind-retry  sample; if flagged, resample with NO diagnostic content
 *   3 repair       sample; if flagged, resample with the verifier's diagnosis
 *   4 best-of-2    two independent samples, verifier picks
 *
 * The headline comparison is 3 vs 2, NOT 3 vs 1. Comparing repair against a
 * single sample confounds the diagnosis's content with the mere fact of a
 * second attempt and with the extra instructions in the repair prompt — the
 * exact confound that made Runs 15-19 misattribute a scaffold effect to card
 * content for a full day.
 *
 * Run:
 *   LEMMA_CARDS_DIR=../../cards HUMANEVAL_SCI_PROMPTS_DIR=... \
 *   node --import=tsx scripts/verifier-repair.ts [model] [limit]
 */

import fs from 'node:fs';
import path from 'node:path';

import { scoreFunctional } from '../scorer/functional.js';
import { scoreVerification, combine } from '../scorer/verification.js';
import { promptsDir, resultsDir, pythonBin } from '../runner/paths.js';
import { METRIC_VERSION } from '../scorer/outcome.js';
import { SYSTEM_CONTROL } from '../runner/adapters/ollama.js';
import type { PromptDefinition, VerificationScore } from '../scorer/types.js';

const MODEL = process.argv[2] ?? 'qwen2.5:7b';
const LIMIT = process.argv[3] ? Number(process.argv[3]) : Infinity;
const HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const TEMP = 0.7;

async function generate(messages: Array<{ role: string; content: string }>) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      options: { temperature: TEMP },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { message?: { content?: string } };
  return stripFences(j.message?.content ?? '');
}

function stripFences(s: string): string {
  const m = s.match(/```(?:python)?\s*\n([\s\S]*?)```/);
  return (m ? m[1]! : s).trim();
}

const userMsg = (p: PromptDefinition) => ({ role: 'user', content: p.prompt });
const sys = { role: 'system', content: SYSTEM_CONTROL };

/** The verifier's own words. Never paraphrased — the engine's prose is what the
 *  parity fixture holds both runtimes to, and it is what a real client sees. */
function diagnosis(v: VerificationScore): string {
  const findings = v.details.filter(
    (d) => d.severity !== 'NONE' && d.severity !== 'UNCHECKED',
  );
  return findings.map((d) => `- ${d.name}: ${d.detail}`).join('\n');
}

async function scoreOne(p: PromptDefinition, code: string) {
  const functional = await scoreFunctional(p, code);
  const verification = await scoreVerification(p, code);
  return { code, ...combine(p, functional, verification), verification };
}

const prompts: PromptDefinition[] = fs
  .readdirSync(promptsDir())
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(promptsDir(), f), 'utf-8')))
  .filter((p: PromptDefinition) => !(p as { adversarial?: unknown }).adversarial)
  .slice(0, LIMIT);

console.log(`verifier-repair · ${MODEL} · ${prompts.length} prompts · T=${TEMP}`);
console.log(`metric v${METRIC_VERSION} · python ${pythonBin()}\n`);

const rows: Array<Record<string, unknown>> = [];
let i = 0;

for (const p of prompts) {
  i++;
  try {
    // Shared first sample: arms 1-4 all start here, so no arm gets a luckier draw.
    const a = await scoreOne(p, await generate([sys, userMsg(p)]));
    const flagged = a.verification.severity !== 'NONE';

    // Arm 4: an independent second sample, verifier picks.
    const b = await scoreOne(p, await generate([sys, userMsg(p)]));
    const pickB =
      1 - penalty(b.verification.severity) > 1 - penalty(a.verification.severity);
    const bestOf2 = pickB ? b : a;

    let retry = a;
    let repair = a;
    if (flagged) {
      // Arm 2 — a second attempt with NO information about what was wrong.
      retry = await scoreOne(
        p,
        await generate([
          sys,
          userMsg(p),
          { role: 'assistant', content: a.code },
          { role: 'user', content: 'That answer may be incorrect. Try again.' },
        ]),
      );
      // Arm 3 — the same second attempt, carrying the verifier's diagnosis.
      repair = await scoreOne(
        p,
        await generate([
          sys,
          userMsg(p),
          { role: 'assistant', content: a.code },
          {
            role: 'user',
            content:
              'A verifier checked that answer and reported:\n' +
              diagnosis(a.verification) +
              '\n\nFix the code so these no longer hold. Return ONLY the code.',
          },
        ]),
      );
    }

    rows.push({
      prompt_id: p.id,
      flagged,
      single: a.overall_score,
      blind_retry: retry.overall_score,
      repair: repair.overall_score,
      best_of_2: bestOf2.overall_score,
      severity_first: a.verification.severity,
    });
    process.stdout.write(
      `  [${String(i).padStart(2)}/${prompts.length}] ${p.id.slice(0, 34).padEnd(34)} ` +
        `${flagged ? 'FLAGGED' : '   ok  '}  ` +
        `single ${a.overall_score.toFixed(2)}  retry ${retry.overall_score.toFixed(2)}  ` +
        `repair ${repair.overall_score.toFixed(2)}  bo2 ${bestOf2.overall_score.toFixed(2)}\n`,
    );
  } catch (err) {
    console.error(`  [${i}] ${p.id} FAILED: ${(err as Error).message}`);
  }
}

function penalty(s: string): number {
  return { NONE: 0, UNCHECKED: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 }[s] ?? 1;
}
const mean = (k: string) =>
  rows.reduce((acc, r) => acc + (r[k] as number), 0) / rows.length;

const flagged = rows.filter((r) => r.flagged);
const worse = flagged.filter((r) => (r.repair as number) < (r.single as number));

console.log(`\n  arms (n=${rows.length}, flagged=${flagged.length})`);
for (const k of ['single', 'blind_retry', 'repair', 'best_of_2'])
  console.log(`    ${k.padEnd(12)} ${mean(k).toFixed(4)}`);

const P1 = mean('repair') > mean('blind_retry');
const P2 = mean('repair') <= mean('best_of_2');
const P3 = flagged.length ? worse.length / flagged.length < 0.15 : null;
const P4 = ['blind_retry', 'repair', 'best_of_2'].every((k) => mean(k) > mean('single'));
const v = (b: boolean | null) => (b === null ? 'N/A    ' : b ? 'MET    ' : 'NOT MET');
console.log('\n  pre-registered:');
console.log(`    P1 repair > blind retry      ${v(P1)}  ${mean('repair').toFixed(4)} vs ${mean('blind_retry').toFixed(4)}`);
console.log(`    P2 repair <= best-of-2       ${v(P2)}  ${mean('repair').toFixed(4)} vs ${mean('best_of_2').toFixed(4)}`);
console.log(`    P3 repair worsens <15%       ${v(P3)}  ${worse.length}/${flagged.length}`);
console.log(`    P4 all 2-gen arms > single   ${v(P4)}`);

fs.mkdirSync(resultsDir, { recursive: true });
const out = path.join(resultsDir, `repair-${MODEL.replace(/[:.]/g, '')}.json`);
fs.writeFileSync(
  out,
  JSON.stringify(
    { model: MODEL, temperature: TEMP, metric_version: METRIC_VERSION, interpreter: pythonBin(), n: rows.length, rows },
    null,
    2,
  ) + '\n',
);
console.log(`\n  wrote ${out}`);
