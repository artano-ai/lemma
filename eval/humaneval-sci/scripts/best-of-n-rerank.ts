#!/usr/bin/env node
/**
 * best-of-n-rerank.ts
 *
 * Test whether the Lemma verification engine is a credible proxy for
 * ground truth at sampling time, as opposed to a tool the model calls
 * at retrieval time. The hypothesis under test:
 *
 *   "Generate N candidates from the same model at temperature > 0.
 *    Score each candidate with Lemma. Picking the highest-Lemma-
 *    scored candidate should outperform picking the first sample,
 *    and should agree with picking the candidate that passes the
 *    most functional tests (the oracle)."
 *
 * Methodology:
 *   - Same 73-prompt set as the existing landmarks
 *   - Same Llama 3.1 8B model via Ollama
 *   - Control-style system prompt (no tools advertised; substrate is
 *     used only at the reranker step, not at generation time)
 *   - N = 5 candidates per prompt, temperature = 0.7
 *   - Each candidate scored with scoreFunctional + scoreVerification
 *
 * Four counterfactual policies are reported, all against the SAME
 * generated candidates:
 *
 *   - single_shot:        pick the first candidate (baseline, ~ T=0
 *                         single sample with a touch of noise)
 *   - functional_oracle:  pick the candidate with highest functional
 *                         pass-rate (uses ground-truth tests — this is
 *                         the upper bound any reranker can achieve)
 *   - lemma_rerank:       pick the candidate with highest Lemma
 *                         overall_score (functional × severity penalty —
 *                         BUT only the verification half is computable
 *                         without ground truth; we report both an
 *                         "honest" (verification-only) and "cheating"
 *                         (full overall) variant)
 *   - random:             pick a candidate uniformly at random (no
 *                         policy; reference baseline for "did
 *                         reranking help at all?")
 *
 * Output:
 *   results/best-of-n-rerank-<ts>.json  — full per-prompt + summary
 *   stdout                              — headline numbers
 *
 * Usage:
 *   node --import=tsx scripts/best-of-n-rerank.ts \
 *     [--model M] [--n N] [--temperature T] [--max-prompts K]
 */
import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';

import { scoreFunctional } from '../scorer/functional.js';
import { scoreVerification, combine } from '../scorer/verification.js';
import type {
  CombinedScore,
  PromptDefinition,
  Severity,
} from '../scorer/types.js';
import { promptsDir as resolvePromptsDir, resultsDir } from '../runner/paths.js';

const args = argv.slice(2);
const argVal = (flag: string, fallback?: string): string | undefined => {
  const i = args.indexOf(flag);
  if (i < 0) return fallback;
  return args[i + 1] ?? fallback;
};

const MODEL = argVal('--model', 'llama3.1:8b')!;
const N = parseInt(argVal('--n', '5')!, 10);
const TEMPERATURE = parseFloat(argVal('--temperature', '0.7')!);
const MAX_PROMPTS = args.includes('--max-prompts')
  ? parseInt(argVal('--max-prompts', '0')!, 10)
  : undefined;
const BASE_URL = argVal('--base-url', 'http://127.0.0.1:11434/v1')!;
const PROMPTS_DIR = resolvePromptsDir();

const SYSTEM_CONTROL =
  'You are a scientific code generation assistant. Write Python code that solves ' +
  'the given task. Return ONLY the code, with no Markdown fences and no commentary. ' +
  'The code must be a complete, runnable function exactly matching the requested signature.';

interface Sample {
  candidate: string;
  functional: import('../scorer/types.js').FunctionalScore;
  verification: import('../scorer/types.js').VerificationScore;
  overall_score: number;
  /** Score that a rerank policy CAN see (no ground-truth test results).
   *  This is the verification-only severity penalty, mapped to a
   *  [0, 1] score. Higher = fewer / lower-severity violations. */
  rerank_score_honest: number;
}

interface PromptResult {
  prompt_id: string;
  domain: string;
  samples: Sample[];
  policies: {
    single_shot: { idx: number; overall_score: number };
    random: { idx: number; overall_score: number };
    functional_oracle: { idx: number; overall_score: number };
    lemma_rerank_full: { idx: number; overall_score: number };
    lemma_rerank_honest: { idx: number; overall_score: number };
  };
  oracle_agreement_full: boolean;
  oracle_agreement_honest: boolean;
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const allPrompts = loadPrompts(PROMPTS_DIR);
  const prompts =
    MAX_PROMPTS !== undefined && MAX_PROMPTS < allPrompts.length
      ? allPrompts.slice(0, MAX_PROMPTS)
      : allPrompts;
  const startedAt = new Date().toISOString();

  console.warn(`Loaded ${prompts.length} prompts.`);
  console.warn(`Model: ${MODEL}, N=${N}, T=${TEMPERATURE}`);
  console.warn('');

  const results: PromptResult[] = [];

  for (let pi = 0; pi < prompts.length; pi++) {
    const prompt = prompts[pi]!;
    const samples: Sample[] = [];
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const candidate = await sample(prompt);
      const functional = await scoreFunctional(prompt, candidate, {
        skeletonMode: false,
      });
      const verification = await scoreVerification(prompt, candidate);
      const combined = combine(prompt, functional, verification);
      samples.push({
        candidate,
        functional,
        verification,
        overall_score: combined.overall_score,
        rerank_score_honest: severityToScore(verification.severity),
      });
    }

    const result = aggregatePolicies(prompt, samples);
    results.push(result);

    const elapsed = Math.round((Date.now() - t0) / 1000);
    const scores = samples.map((s) => s.overall_score);
    console.warn(
      `  [${pi + 1}/${prompts.length}] ${prompt.id.padEnd(46)} ` +
        `samples=[${scores.map((s) => s.toFixed(2)).join(',')}] ` +
        `single=${result.policies.single_shot.overall_score.toFixed(2)} ` +
        `oracle=${result.policies.functional_oracle.overall_score.toFixed(2)} ` +
        `lemma_h=${result.policies.lemma_rerank_honest.overall_score.toFixed(2)} ` +
        `lemma_f=${result.policies.lemma_rerank_full.overall_score.toFixed(2)} ` +
        `(${elapsed}s)`,
    );

    // Incremental write
    writeOutput(startedAt, results, /* partial */ true);
  }

  writeOutput(startedAt, results, /* partial */ false);
  printSummary(results);
}

// ---------------------------------------------------------------------------

interface ChatResponse {
  choices: Array<{ message: { content: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function sample(prompt: PromptDefinition): Promise<string> {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_CONTROL },
      { role: 'user', content: prompt.prompt },
    ],
    temperature: TEMPERATURE,
  };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = (await res.json()) as ChatResponse;
  const raw = j.choices?.[0]?.message?.content ?? '';
  return stripCodeFences(raw);
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:python|py)?\s*\n([\s\S]*?)\n```$/);
  return m ? m[1]! : trimmed;
}

function loadPrompts(dir: string): PromptDefinition[] {
  const entries = fs.readdirSync(dir).filter((e) => e.endsWith('.json')).sort();
  return entries.map((e) =>
    JSON.parse(fs.readFileSync(path.join(dir, e), 'utf-8')),
  );
}

function severityToScore(s: Severity): number {
  // Inverse of the severity penalty: a candidate with NONE severity
  // earns 1.0, with HIGH severity earns 0. Lets us use verification
  // alone as the rerank signal — i.e. the score a deployed router
  // could actually see (no ground-truth tests).
  const penalty = { NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 }[s] ?? 1.0;
  return 1 - penalty;
}

function aggregatePolicies(
  prompt: PromptDefinition,
  samples: Sample[],
): PromptResult {
  // Single-shot: first sample
  const single_shot = { idx: 0, overall_score: samples[0]!.overall_score };

  // Random: uniformly pick one index — deterministic per-prompt via
  // prompt id hash so reruns are reproducible.
  const seed = hashString(prompt.id) % samples.length;
  const random = { idx: seed, overall_score: samples[seed]!.overall_score };

  // Functional oracle: pick the candidate with highest functional
  // pass rate. Ties broken by index (stable, leftmost wins).
  const oracleIdx = argmax(samples, (s) => s.functional.pass_rate);
  const functional_oracle = {
    idx: oracleIdx,
    overall_score: samples[oracleIdx]!.overall_score,
  };

  // Lemma rerank, "full overall": pick highest overall_score
  // (= functional × (1 - severity_penalty)). This CAN'T be deployed
  // — it needs ground-truth test results. Reported as the upper
  // bound for what Lemma's score-shape would pick.
  const lemmaFullIdx = argmax(samples, (s) => s.overall_score);
  const lemma_rerank_full = {
    idx: lemmaFullIdx,
    overall_score: samples[lemmaFullIdx]!.overall_score,
  };

  // Lemma rerank, "honest": pick the candidate with the lowest
  // verification severity (= highest rerank_score_honest). This IS
  // deployable — no ground-truth tests used. This is the headline
  // policy for the "Lemma as post-hoc verifier" hypothesis.
  const lemmaHonestIdx = argmax(samples, (s) => s.rerank_score_honest);
  const lemma_rerank_honest = {
    idx: lemmaHonestIdx,
    overall_score: samples[lemmaHonestIdx]!.overall_score,
  };

  return {
    prompt_id: prompt.id,
    domain: prompt.domain,
    samples,
    policies: {
      single_shot,
      random,
      functional_oracle,
      lemma_rerank_full,
      lemma_rerank_honest,
    },
    oracle_agreement_full: lemmaFullIdx === oracleIdx,
    oracle_agreement_honest: lemmaHonestIdx === oracleIdx,
  };
}

function argmax<T>(xs: T[], key: (x: T) => number): number {
  let best = 0;
  let bestKey = key(xs[0]!);
  for (let i = 1; i < xs.length; i++) {
    const k = key(xs[i]!);
    if (k > bestKey) {
      best = i;
      bestKey = k;
    }
  }
  return best;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function writeOutput(
  startedAt: string,
  results: PromptResult[],
  partial: boolean,
): void {
  // Strip candidate strings from the partial JSON to keep it small;
  // only retain in the final write.
  const out = {
    run_started_at: startedAt,
    model: MODEL,
    temperature: TEMPERATURE,
    n_samples: N,
    prompts_evaluated: results.length,
    partial,
    per_prompt: results,
    summary: partial ? undefined : summarise(results),
  };
  fs.mkdirSync(resultsDir, { recursive: true });
  const filename = `best-of-n-rerank-${startedAt.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(
    path.join(resultsDir, filename),
    JSON.stringify(out, null, 2),
  );
}

function summarise(results: PromptResult[]) {
  const n = results.length;
  const pol = (sel: (r: PromptResult) => number) =>
    results.reduce((s, r) => s + sel(r), 0) / n;
  return {
    n_prompts: n,
    mean_overall_score: {
      single_shot: pol((r) => r.policies.single_shot.overall_score),
      random: pol((r) => r.policies.random.overall_score),
      functional_oracle: pol(
        (r) => r.policies.functional_oracle.overall_score,
      ),
      lemma_rerank_full: pol(
        (r) => r.policies.lemma_rerank_full.overall_score,
      ),
      lemma_rerank_honest: pol(
        (r) => r.policies.lemma_rerank_honest.overall_score,
      ),
    },
    oracle_agreement: {
      lemma_rerank_full: results.filter((r) => r.oracle_agreement_full).length / n,
      lemma_rerank_honest: results.filter((r) => r.oracle_agreement_honest).length / n,
    },
  };
}

function printSummary(results: PromptResult[]): void {
  const s = summarise(results);
  console.log('');
  console.log('=== Best-of-N + Lemma rerank summary ===');
  console.log(`n prompts evaluated:      ${s.n_prompts}`);
  console.log(`N samples per prompt:     ${N}`);
  console.log(`Temperature:              ${TEMPERATURE}`);
  console.log('');
  console.log('Mean overall score by policy:');
  console.log(`  single_shot          ${s.mean_overall_score.single_shot.toFixed(3)}  (first sample)`);
  console.log(`  random               ${s.mean_overall_score.random.toFixed(3)}  (uniform of 5)`);
  console.log(`  functional_oracle    ${s.mean_overall_score.functional_oracle.toFixed(3)}  (uses tests — UPPER BOUND)`);
  console.log(`  lemma_rerank_full    ${s.mean_overall_score.lemma_rerank_full.toFixed(3)}  (uses tests via overall_score — bound)`);
  console.log(`  lemma_rerank_honest  ${s.mean_overall_score.lemma_rerank_honest.toFixed(3)}  (verification only — DEPLOYABLE)`);
  console.log('');
  console.log('Oracle agreement (winner matches functional_oracle):');
  console.log(`  lemma_rerank_full    ${(s.oracle_agreement.lemma_rerank_full * 100).toFixed(1)}%`);
  console.log(`  lemma_rerank_honest  ${(s.oracle_agreement.lemma_rerank_honest * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
