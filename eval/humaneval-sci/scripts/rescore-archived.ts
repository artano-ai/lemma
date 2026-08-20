// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Re-score archived candidates through the real scorers.
 *
 * Run:
 *   HUMANEVAL_SCI_PROMPTS_DIR=... LEMMA_CARDS_DIR=... \
 *   HUMANEVAL_SCI_PYTHON=.venv/bin/python \
 *   node --import=tsx scripts/rescore-archived.ts <record.json>
 *
 * Costs no inference: run records store each candidate's source, so the
 * functional and differential scorers can be re-run over the archived text.
 * Only the *scoring* is redone, never the generation — so a change to the
 * harness can be measured against the exact candidates that produced the
 * published numbers.
 *
 * Reports the archived score next to the recomputed one, per arm, so a
 * harness fix shows up as a delta rather than as a new absolute number with
 * nothing to compare it against.
 */

import fs from 'node:fs';
import path from 'node:path';

import { scoreFunctional } from '../scorer/functional.js';
import { scoreVerification, combine } from '../scorer/verification.js';
import { promptsDir, pythonBin } from '../runner/paths.js';
import { METRIC_VERSION } from '../scorer/outcome.js';
import type { PromptDefinition } from '../scorer/types.js';

interface ArchivedRun {
  prompt_id: string;
  candidate?: string;
  functional?: { pass_rate: number };
  overall_score: number;
}

function loadPrompts(): Map<string, PromptDefinition> {
  const dir = promptsDir();
  const m = new Map<string, PromptDefinition>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = JSON.parse(
      fs.readFileSync(path.join(dir, f), 'utf-8'),
    ) as PromptDefinition;
    m.set(p.id, p);
  }
  return m;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function rescoreRuns(
  runs: ArchivedRun[],
  prompts: Map<string, PromptDefinition>,
  sink: Record<string, number> = {},
  rescored: unknown[] = [],
): Promise<{ before: number[]; after: number[]; funcBefore: number[]; funcAfter: number[]; missing: number }> {
  const before: number[] = [];
  const after: number[] = [];
  const funcBefore: number[] = [];
  const funcAfter: number[] = [];
  let missing = 0;

  for (const r of runs) {
    const prompt = prompts.get(r.prompt_id);
    if (!prompt || r.candidate === undefined) {
      missing++;
      continue;
    }
    const functional = await scoreFunctional(prompt, r.candidate);
    const verification = await scoreVerification(prompt, r.candidate);
    const combined = combine(prompt, functional, verification);
    before.push(r.overall_score);
    after.push(combined.overall_score);
    sink[r.prompt_id] = combined.overall_score;
    rescored.push({ ...combined, archived_overall_score: r.overall_score });
    funcBefore.push(r.functional?.pass_rate ?? 0);
    funcAfter.push(functional.pass_rate);
  }
  return { before, after, funcBefore, funcAfter, missing };
}

const file = process.argv[2];
const outIdx = process.argv.indexOf('-o');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : undefined;
if (!file) {
  console.error(
    'usage: node --import=tsx scripts/rescore-archived.ts <record.json> [-o <out.json>]',
  );
  process.exit(2);
}

const record = JSON.parse(fs.readFileSync(file, 'utf-8'));
const prompts = loadPrompts();

// A/B record (control/treatment arrays) or a best-of-N record (samples).
const arms: Record<string, ArchivedRun[]> = {};
for (const p of record.per_prompt ?? []) {
  for (const arm of ['control', 'treatment']) {
    if (Array.isArray(p[arm])) (arms[arm] ??= []).push(...p[arm]);
  }
  if (Array.isArray(p.samples)) {
    (arms.samples ??= []).push(
      ...p.samples.map((s: ArchivedRun) => ({ ...s, prompt_id: p.prompt_id })),
    );
  }
}

const perPrompt: Record<string, Record<string, number>> = {};
const emitted: Record<string, unknown[]> = {};
console.log(`\n${path.basename(file)}`);
// The RESOLVED binary, not the env var: the var is optional (a repo-local
// .venv is auto-detected), so reporting it would label an auto-detected venv
// run as "python3 (default)" — a provenance field that misstates which
// interpreter produced the numbers.
console.log(`  interpreter: ${pythonBin()}`);

for (const [name, runs] of Object.entries(arms)) {
  const sink: Record<string, number> = {};
  const rescored: unknown[] = [];
  const r = await rescoreRuns(runs, prompts, sink, rescored);
  perPrompt[name] = sink;
  emitted[name] = rescored;
  const ob = mean(r.before);
  const oa = mean(r.after);
  const fb = mean(r.funcBefore);
  const fa = mean(r.funcAfter);
  console.log(
    `  ${name.padEnd(10)} n=${String(r.before.length).padStart(4)}` +
      `  overall ${ob.toFixed(3)} -> ${oa.toFixed(3)} (${oa - ob >= 0 ? '+' : ''}${(oa - ob).toFixed(3)})` +
      `   func ${fb.toFixed(3)} -> ${fa.toFixed(3)} (${fa - fb >= 0 ? '+' : ''}${(fa - fb).toFixed(3)})` +
      (r.missing ? `  [${r.missing} skipped]` : ''),
  );
}

// Paired statistics on the arms, when both are present.
if (perPrompt.control && perPrompt.treatment) {
  const ids = Object.keys(perPrompt.control).filter(
    (k) => k in perPrompt.treatment!,
  );
  const deltas = ids.map((k) => perPrompt.treatment![k]! - perPrompt.control![k]!);
  const n = deltas.length;
  const m = deltas.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(
    deltas.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1),
  );
  const se = sd / Math.sqrt(n);
  console.log(
    `  paired  n=${n}  delta=${m >= 0 ? '+' : ''}${m.toFixed(4)}  ` +
      `t=${(m / se).toFixed(2)}  95% CI [${(m - 1.99 * se).toFixed(3)}, ${(m + 1.99 * se).toFixed(3)}]`,
  );
}


if (outFile) {
  // A DERIVED record, deliberately not shaped like a fresh run: it carries
  // provenance and both scores per candidate, so it can never be mistaken for
  // a re-baselined original. Adding prompts or changing the metric means a NEW
  // landmark — an existing one is never silently rewritten.
  const out = {
    kind: 'rescore',
    rescored_at: new Date().toISOString(),
    source_record: path.basename(file),
    metric_version: METRIC_VERSION,
    interpreter: pythonBin(),
    what_changed: [
      'UNCHECKED outcome: a declined check no longer costs 0.25 (metric v1 -> v2)',
      'python interpreter supplies numpy/scipy under -I (harness environment fix)',
    ],
    source_model:
      record.model ?? record.control_model_id ?? record.treatment_model_id ?? null,
    arms: emitted,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`  wrote ${outFile}`);
}
