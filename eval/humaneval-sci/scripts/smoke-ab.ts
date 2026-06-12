// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * A/B smoke test — runs every prompt through Gemini in both control
 * (LLM only) and treatment (LLM + Lemma tools) conditions, scores
 * both, and prints the paired delta.
 *
 * Requires GEMINI_API_KEY in the environment (or in .env.local).
 * Default model `gemini-2.5-flash` has a 5 RPM free-tier quota, so
 * the smoke takes ~4 minutes with built-in 429 retry. For faster runs,
 * pass --model with a higher-quota option (see Usage).
 *
 * Output layout:
 *   results/ab-smoke-latest.json          — pointer to the most recent run
 *   results/runs/ab-<timestamp>.json      — archived per-run results (includes candidate text)
 *   results/logs/ab-<timestamp>.log       — full terminal output, captured
 *
 * Usage (Gemini API, default):
 *   pnpm smoke-ab
 *   pnpm smoke-ab --runs 3                            # 3 generations per condition
 *   pnpm smoke-ab --model gemini-2.5-flash-lite       # 15 RPM tier
 *
 * Usage (local Ollama — no quota walls):
 *   pnpm smoke-ab --ollama                            # default model: gemma3:4b
 *   pnpm smoke-ab --ollama --max-prompts 5            # FAST proof-of-concept (5 prompts)
 *   pnpm smoke-ab --ollama --model gemma3:12b         # larger Gemma (needs ≥16 GB free)
 *   pnpm smoke-ab --ollama --model qwen2.5-coder:7b   # alternative open-weights
 *
 * Usage (remote OpenAI-compatible endpoint — Nebius, OpenRouter, vLLM, ...):
 *   OPENAI_COMPAT_API_KEY=... pnpm smoke-ab --ollama \
 *     --base-url https://api.studio.nebius.com/v1 \
 *     --model meta-llama/Meta-Llama-3.1-70B-Instruct
 *
 * Usage (no API calls — exercises the harness only):
 *   pnpm smoke-ab --offline
 */
import fs from 'node:fs';
import path from 'node:path';

import { runAbEvaluation } from '../runner/ab-runner.js';
import { createGeminiAdapter } from '../runner/adapters/gemini.js';
import { createOllamaAdapter } from '../runner/adapters/ollama.js';
import { referenceAdapter } from '../runner/runner.js';
import { promptsDir as resolvePromptsDir, resultsDir } from '../runner/paths.js';

const promptsDir = resolvePromptsDir();
const outputFile = path.join(resultsDir, 'ab-smoke-latest.json');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runId = `ab-${timestamp}`;
const archiveJson = path.join(resultsDir, 'runs', `${runId}.json`);
const logFile = path.join(resultsDir, 'logs', `${runId}.log`);
fs.mkdirSync(path.dirname(archiveJson), { recursive: true });
fs.mkdirSync(path.dirname(logFile), { recursive: true });

// Tee everything we print to disk so a full transcript is preserved
// alongside the structured JSON. Captures console.log + console.error
// + any direct process.stdout.write calls inside the runner / adapter.
const logStream = fs.createWriteStream(logFile, { flags: 'a' });
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
type WriteSig = typeof process.stdout.write;
const tee = (origWrite: WriteSig): WriteSig => {
  return ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string' || chunk instanceof Uint8Array) {
      logStream.write(chunk);
    }
    return origWrite(chunk as never, ...(rest as never[]));
  }) as unknown as WriteSig;
};
process.stdout.write = tee(origStdoutWrite);
process.stderr.write = tee(origStderrWrite);

// Archive whatever results exist when the process exits — runs to
// completion OR crashes. The runner writes incrementally after every
// prompt, so even a partial run leaves a self-consistent file behind.
process.on('exit', () => {
  try {
    if (fs.existsSync(outputFile)) {
      fs.copyFileSync(outputFile, archiveJson);
      origStdoutWrite(`\n[archive] Saved partial/final result to ${archiveJson}\n`);
    }
    origStdoutWrite(`[archive] Log file: ${logFile}\n`);
  } catch {
    // Best-effort — don't mask the original exit error.
  }
});

const runsArgIdx = process.argv.indexOf('--runs');
const runsPerCondition =
  runsArgIdx >= 0 ? parseInt(process.argv[runsArgIdx + 1] ?? '1', 10) : 1;

const modelArgIdx = process.argv.indexOf('--model');
const modelOverride =
  modelArgIdx >= 0 ? process.argv[modelArgIdx + 1] : undefined;

// Offline mode: use the reference adapter as BOTH arms. Exercises the
// entire harness (incremental writes, archive, log capture, candidate
// persistence) without burning API quota. Both arms produce identical
// scores so the paired delta is mechanically zero — that is the point.
const offline = process.argv.includes('--offline');

// Ollama / OpenAI-compatible mode: run against a local Ollama daemon
// or a remote OpenAI-compatible endpoint (Nebius, OpenRouter, vLLM, ...).
// Default model gemma3:4b — small enough to fit a 16 GB Mac. Override
// with --model. Set --base-url to point at a non-localhost endpoint.
const useOllama = process.argv.includes('--ollama');

const baseUrlArgIdx = process.argv.indexOf('--base-url');
const baseUrlOverride =
  baseUrlArgIdx >= 0 ? process.argv[baseUrlArgIdx + 1] : undefined;

const maxPromptsArgIdx = process.argv.indexOf('--max-prompts');
const maxPrompts =
  maxPromptsArgIdx >= 0
    ? parseInt(process.argv[maxPromptsArgIdx + 1] ?? '0', 10)
    : undefined;

// `--force-first-tool` sets tool_choice=required on the first
// treatment-arm turn. Default off: let the model self-route. Kept as
// an opt-in because some weak instruction-tuned models (Mistral 7B)
// ignore the system-prompt nudge entirely without it. See the Ollama
// adapter for the full rationale.
const forceFirstToolCall = process.argv.includes('--force-first-tool');

// `--no-think` switches the Ollama adapter to the native /api/chat
// endpoint with `think: false`. Required for models like Qwen3 that
// default to chain-of-thought output and emit ~1000s of reasoning
// tokens per call. The OpenAI-compat /v1/chat/completions endpoint
// silently ignores thinking-control fields, so the native API is the
// only reliable path. Also keeps `/no_think` in the system prompt as
// a belt-and-braces — it costs nothing on models that don't parse it.
const noThink = process.argv.includes('--no-think');
const systemPromptPrefix = noThink ? '/no_think' : undefined;
const useNativeApi = noThink;
const disableThinking = noThink;

if (!offline && !useOllama && !process.env.GEMINI_API_KEY) {
  console.error(
    '\nGEMINI_API_KEY is not set.\n' +
      'Get a free key at https://aistudio.google.com/apikey,\n' +
      'then add to humaneval-sci/.env.local:\n\n' +
      '    GEMINI_API_KEY=your_key_here\n\n' +
      'or export it in the shell before running pnpm smoke-ab.\n',
  );
  process.exit(1);
}

const control = offline
  ? { ...referenceAdapter, id: `${referenceAdapter.id}:control` }
  : useOllama
    ? createOllamaAdapter({
        condition: 'control',
        model: modelOverride,
        baseUrl: baseUrlOverride,
        apiKey: process.env.OPENAI_COMPAT_API_KEY,
        systemPromptPrefix,
        useNativeApi,
        disableThinking,
      })
    : createGeminiAdapter({ condition: 'control', model: modelOverride });
const treatment = offline
  ? { ...referenceAdapter, id: `${referenceAdapter.id}:treatment` }
  : useOllama
    ? createOllamaAdapter({
        condition: 'treatment',
        model: modelOverride,
        baseUrl: baseUrlOverride,
        apiKey: process.env.OPENAI_COMPAT_API_KEY,
        forceFirstToolCall,
        systemPromptPrefix,
        useNativeApi,
        disableThinking,
      })
    : createGeminiAdapter({ condition: 'treatment', model: modelOverride });

console.log('\n=== HumanEval-Sci A/B smoke run ===');
console.log(`Run id:     ${runId}`);
console.log(`Control:    ${control.id}`);
console.log(`Treatment:  ${treatment.id}`);
console.log(`Runs/cond:  ${runsPerCondition}`);
if (maxPrompts !== undefined && maxPrompts > 0) {
  console.log(`Max prompts: ${maxPrompts}  (subset; first N alphabetically)`);
}
console.log('');

const result = await runAbEvaluation({
  promptsDir,
  outputFile,
  controlAdapter: control,
  treatmentAdapter: treatment,
  runsPerCondition,
  maxPrompts,
  skeletonMode: false,
  onProgress: (info) => {
    const tag = info.condition.padEnd(9);
    const usage = info.usage
      ? `  | in=${info.usage.input_tokens} out=${info.usage.output_tokens} turns=${info.usage.turn_count} tools=${info.usage.tool_calls_count}`
      : '';
    process.stdout.write(
      `  [${tag}] ${info.prompt_id} (run ${info.run_index + 1}/${info.total_runs}) → overall ${info.overall_score.toFixed(3)}${usage}\n`,
    );
  },
});

console.log('\n=== Aggregate ===');
printCondition('CONTROL  ', result.control_stats);
printCondition('TREATMENT', result.treatment_stats);

console.log('\n=== Paired t-test (treatment − control) ===');
printPaired('overall score   ', result.paired_t_test.overall_score);
printPaired('functional pass ', result.paired_t_test.functional_pass_rate);
console.log(`  n prompts (paired):          ${result.paired_delta.n_prompts}`);

// Token-usage aggregate — sum across all prompts × all runs in each arm.
const controlUsage = sumUsage(result.per_prompt.flatMap((p) => p.control));
const treatmentUsage = sumUsage(result.per_prompt.flatMap((p) => p.treatment));
if (controlUsage || treatmentUsage) {
  console.log('\n=== Token usage ===');
  if (controlUsage) printUsage('CONTROL  ', controlUsage);
  if (treatmentUsage) printUsage('TREATMENT', treatmentUsage);
  if (controlUsage && treatmentUsage) {
    const ratio = treatmentUsage.total_tokens / controlUsage.total_tokens;
    console.log(
      `  ratio treatment/control: ${ratio.toFixed(2)}x  ` +
        `(treatment uses ${((ratio - 1) * 100).toFixed(0)}% more tokens)`,
    );
  }
}
console.log('');

// Archive happens via the process.on('exit') hook above so it fires
// on crash too — just log the destinations here.
console.log(`Results (latest):   ${outputFile}`);
console.log(`Results (archive):  ${archiveJson}`);
console.log(`Log (full trace):   ${logFile}\n`);

// Verdict: require BOTH effect size AND statistical significance.
// A non-significant +0.04 with CI [-0.71, +0.79] is not a result.
const tOverall = result.paired_t_test.overall_score;
const delta = tOverall.mean_delta;
const sig = tOverall.significant_at_0_05;

// Also check whether the treatment arm actually used Lemma — if every
// treatment prompt has 0 tool calls, the experimental design is
// confounded ("treatment" is just "control + bigger system prompt").
const treatmentToolCalls = result.per_prompt
  .flatMap((p) => p.treatment)
  .map((s) => s.usage?.tool_calls_count ?? 0);
const totalTreatmentToolCalls = treatmentToolCalls.reduce((a, b) => a + b, 0);
const promptsThatUsedTools = treatmentToolCalls.filter((n) => n > 0).length;

if (totalTreatmentToolCalls === 0 && result.per_prompt.length > 0 && result.per_prompt.some((p) => p.treatment.some((t) => t.usage))) {
  console.log(
    '⚠ Treatment arm made 0 tool calls across all prompts — experimental\n' +
      '  design is confounded. The model received the Lemma system-prompt\n' +
      '  nudge but never invoked any tool. Any "delta" here reflects\n' +
      '  system-prompt verbosity, not Lemma usage. Force tool use or\n' +
      '  switch to a more tool-eager model.\n',
  );
} else if (sig && delta > 0.01) {
  console.log(
    `✓ Lemma adds measurable value: Δ=${signed(delta)} with p=${formatP(tOverall.p_value_two_tailed)}.\n` +
      `  Treatment used tools on ${promptsThatUsedTools}/${result.per_prompt.length} prompts.\n`,
  );
} else if (sig && delta < -0.01) {
  console.log(
    `⚠ Treatment significantly underperforms control: Δ=${signed(delta)} with p=${formatP(tOverall.p_value_two_tailed)}. ` +
      'Investigate before publishing.\n',
  );
} else {
  console.log(
    `No significant delta (Δ=${signed(delta)}, p=${formatP(tOverall.p_value_two_tailed)}). ` +
      `${result.per_prompt.length < 20 ? 'n too small — expand the prompt set.' : 'Effect size below detectability at this n.'}\n`,
  );
}

// Flush the tee'd log before exit so nothing is lost.
logStream.end();

function printCondition(
  label: string,
  s: { mean_functional_pass_rate: number; mean_overall_score: number; std_err_overall_score: number; n_observations: number; severity_distribution: Record<string, number> },
) {
  console.log(
    `  ${label}  func_pass=${s.mean_functional_pass_rate.toFixed(3)}  ` +
      `overall=${s.mean_overall_score.toFixed(3)} ± ${s.std_err_overall_score.toFixed(3)}  ` +
      `n=${s.n_observations}  ` +
      `severity=${JSON.stringify(s.severity_distribution)}`,
  );
}

function printPaired(
  label: string,
  t: {
    mean_delta: number;
    ci_95_low: number;
    ci_95_high: number;
    t_statistic: number;
    degrees_of_freedom: number;
    p_value_two_tailed: number;
    significant_at_0_05: boolean;
  },
) {
  const sig = t.significant_at_0_05 ? '*' : ' ';
  console.log(
    `  Δ ${label}: ${signed(t.mean_delta)}  ` +
      `[95% CI ${signed(t.ci_95_low)}, ${signed(t.ci_95_high)}]  ` +
      `t(${t.degrees_of_freedom}) = ${t.t_statistic.toFixed(2)}  ` +
      `p = ${formatP(t.p_value_two_tailed)} ${sig}`,
  );
}

function signed(n: number): string {
  if (!Number.isFinite(n)) return n > 0 ? '+∞' : '−∞';
  const s = n.toFixed(3);
  return n > 0 ? `+${s}` : s;
}

function formatP(p: number): string {
  if (p < 0.001) return '<0.001';
  if (p < 0.01) return p.toFixed(3);
  return p.toFixed(2);
}

interface UsageSum {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  total_tokens: number;
  turn_count: number;
  prompts_with_usage: number;
}

function sumUsage(scores: Array<{ usage?: { input_tokens: number; output_tokens: number; cached_input_tokens: number; total_tokens: number; turn_count: number } }>): UsageSum | null {
  let any = false;
  const sum: UsageSum = {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    total_tokens: 0,
    turn_count: 0,
    prompts_with_usage: 0,
  };
  for (const s of scores) {
    if (!s.usage) continue;
    any = true;
    sum.input_tokens += s.usage.input_tokens;
    sum.output_tokens += s.usage.output_tokens;
    sum.cached_input_tokens += s.usage.cached_input_tokens;
    sum.total_tokens += s.usage.total_tokens;
    sum.turn_count += s.usage.turn_count;
    sum.prompts_with_usage += 1;
  }
  return any ? sum : null;
}

function printUsage(label: string, u: UsageSum) {
  const meanIn = u.input_tokens / u.prompts_with_usage;
  const meanOut = u.output_tokens / u.prompts_with_usage;
  const meanTurns = u.turn_count / u.prompts_with_usage;
  console.log(
    `  ${label}  in=${u.input_tokens.toLocaleString()}  out=${u.output_tokens.toLocaleString()}  ` +
      `total=${u.total_tokens.toLocaleString()}  turns=${u.turn_count}  ` +
      `mean/prompt: in=${meanIn.toFixed(0)} out=${meanOut.toFixed(0)} turns=${meanTurns.toFixed(2)}`,
  );
}
