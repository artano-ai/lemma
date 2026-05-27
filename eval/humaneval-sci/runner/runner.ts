/**
 * HumanEval-Sci runner — orchestrates: load prompts → call model →
 * score → write results.
 *
 * v0 skeleton: the runner sequence is real, but the model adapter and
 * the sandbox-execution layer in the scorer are stubs. Wire a real
 * adapter (Anthropic / OpenAI / local Sci-Coder) and a real Python
 * sandbox to unblock end-to-end runs.
 *
 * Usage (once wired):
 *   pnpm tsx runner.ts \
 *     --prompts ../prompts \
 *     --model anthropic:claude-sonnet-4 \
 *     --output ../results/run-2026-05-04.json
 */
import fs from 'node:fs';
import path from 'node:path';

import type {
  CombinedScore,
  PromptDefinition,
  TokenUsage,
} from '../scorer/types.js';
// TraceTurn re-exported via GenerateResult for adapter use.
import type { TraceTurn } from '../scorer/types.js';
export type { TraceTurn };
import { scoreFunctional } from '../scorer/functional.js';
import { combine, scoreVerification } from '../scorer/verification.js';

/**
 * Two experimental conditions for the A/B harness.
 *
 *   - `control`    — model gets the prompt only, no scientific corpus or
 *                    verification tools. Baseline LLM capability.
 *   - `treatment`  — model gets the prompt PLUS access to Lemma tools
 *                    (cards lookup, cross-check). Measures the value
 *                    added by the open verification substrate.
 *
 * The same model in both conditions isolates Lemma as the only
 * independent variable.
 */
export type Condition = 'control' | 'treatment';

/** Adapter call result. Adapters that do not make an API call (e.g.
 *  the reference adapter) return `usage: undefined` and `trace:
 *  undefined`. */
export interface GenerateResult {
  candidate: string;
  usage?: TokenUsage;
  /** Full agent-loop conversation history. See TraceTurn in
   *  scorer/types.ts. */
  trace?: TraceTurn[];
}

export interface ModelAdapter {
  /** Identifier used in result metadata, e.g. "gemini-2.5-flash". */
  id: string;
  /** Which experimental condition this adapter implements. */
  condition: Condition;
  /** Generate a code completion for the given prompt. Returns the
   *  candidate code plus (optionally) token-usage metadata for the
   *  full agent loop on that prompt. */
  generate(prompt: PromptDefinition): Promise<GenerateResult>;
}

export interface RunOptions {
  promptsDir: string;
  outputFile: string;
  adapter: ModelAdapter;
  skeletonMode?: boolean;
}

export interface RunResult {
  model_id: string;
  run_started_at: string;
  prompts_evaluated: number;
  per_prompt: CombinedScore[];
  aggregate: {
    mean_functional_pass_rate: number;
    mean_overall_score: number;
    severity_distribution: Record<string, number>;
  };
}

export async function runEvaluation(opts: RunOptions): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const prompts = loadPrompts(opts.promptsDir);
  const perPrompt: CombinedScore[] = [];

  for (const prompt of prompts) {
    const { candidate, usage } = await opts.adapter.generate(prompt);
    const functional = await scoreFunctional(prompt, candidate, {
      skeletonMode: opts.skeletonMode ?? true,
    });
    const verification = await scoreVerification(prompt, candidate);
    const score = combine(prompt, functional, verification);
    perPrompt.push({ ...score, candidate, ...(usage ? { usage } : {}) });
  }

  const aggregate = aggregate_(perPrompt);
  const result: RunResult = {
    model_id: opts.adapter.id,
    run_started_at: startedAt,
    prompts_evaluated: perPrompt.length,
    per_prompt: perPrompt,
    aggregate,
  };

  fs.mkdirSync(path.dirname(opts.outputFile), { recursive: true });
  fs.writeFileSync(opts.outputFile, JSON.stringify(result, null, 2));
  return result;
}

function loadPrompts(dir: string): PromptDefinition[] {
  const out: PromptDefinition[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(dir, entry);
    const json = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    out.push(json as PromptDefinition);
  }
  return out;
}

function aggregate_(scores: CombinedScore[]): RunResult['aggregate'] {
  const n = scores.length;
  if (n === 0) {
    return {
      mean_functional_pass_rate: 0,
      mean_overall_score: 0,
      severity_distribution: {},
    };
  }
  const meanFunc =
    scores.reduce((s, x) => s + x.functional.pass_rate, 0) / n;
  const meanOverall =
    scores.reduce((s, x) => s + x.overall_score, 0) / n;
  const dist: Record<string, number> = { NONE: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
  for (const s of scores) dist[s.verification.severity]++;
  return {
    mean_functional_pass_rate: meanFunc,
    mean_overall_score: meanOverall,
    severity_distribution: dist,
  };
}

/** Echo adapter — returns the reference solution. Useful for a sanity
 *  baseline on the scorer (functional pass rate should be 100% in
 *  skeleton mode since reference == reference). Tagged as `control` so
 *  it slots into the A/B runner; it is not a real LLM. */
export const referenceAdapter: ModelAdapter = {
  id: 'reference-solution',
  condition: 'control',
  async generate(prompt: PromptDefinition): Promise<GenerateResult> {
    return { candidate: prompt.reference_solution };
  },
};
