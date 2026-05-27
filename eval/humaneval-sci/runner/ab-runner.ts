/**
 * A/B runner — drives a paired control-vs-treatment experiment over
 * a prompt set.
 *
 * The same prompt goes through both adapters (control = LLM only,
 * treatment = LLM + Lemma tools), each repeated N times to dampen
 * sampling noise. The paired structure means we can compute per-prompt
 * deltas, not just marginal means, which is what the headline number
 * needs.
 *
 * Output: a single JSON with per-prompt rows, per-condition aggregates,
 * and per-domain breakdown. Stats (paired mean delta, std error) live
 * in scorer/stats.ts.
 */
import fs from 'node:fs';
import path from 'node:path';

import { scoreFunctional } from '../scorer/functional.js';
import type { CombinedScore, PromptDefinition } from '../scorer/types.js';
import { combine, scoreVerification } from '../scorer/verification.js';
import {
  aggregateRuns,
  pairedTTest,
  type ConditionStats,
  type PairedTestResult,
} from '../scorer/stats.js';
import type { ModelAdapter } from './runner.js';

export interface AbRunOptions {
  promptsDir: string;
  outputFile: string;
  controlAdapter: ModelAdapter;
  treatmentAdapter: ModelAdapter;
  /** Number of generations per (prompt × condition). 1 for cheap smoke,
   *  5 for the published number. Default 1. */
  runsPerCondition?: number;
  /** When true, the functional scorer treats the candidate code as
   *  source-equal-to-reference (skipping sandbox execution). Useful for
   *  the unit-test smoke; set to false once a real sandbox is wired. */
  skeletonMode?: boolean;
  /** Optional cap on the number of prompts to evaluate. Prompts are
   *  sorted lexicographically before slicing so the subset is
   *  reproducible across runs. Useful for fast proof-of-concept
   *  runs against slow local models. */
  maxPrompts?: number;
  /** Optional progress hook — called once per (prompt, condition, run). */
  onProgress?: (info: ProgressInfo) => void;
}

export interface ProgressInfo {
  prompt_id: string;
  condition: 'control' | 'treatment';
  run_index: number;
  total_runs: number;
  overall_score: number;
  usage?: import('../scorer/types.js').TokenUsage;
}

export interface AbRunResult {
  run_started_at: string;
  control_model_id: string;
  treatment_model_id: string;
  prompts_evaluated: number;
  runs_per_condition: number;
  per_prompt: AbPromptResult[];
  control_stats: ConditionStats;
  treatment_stats: ConditionStats;
  paired_delta: {
    mean_overall_score_delta: number;
    mean_functional_pass_rate_delta: number;
    n_prompts: number;
  };
  /** Full paired-t-test result for the headline metric (overall_score)
   *  and for functional_pass_rate. n is number of prompts; per-prompt
   *  deltas are computed on per-run means within each condition. */
  paired_t_test: {
    overall_score: PairedTestResult;
    functional_pass_rate: PairedTestResult;
  };
}

export interface AbPromptResult {
  prompt_id: string;
  domain: string;
  card_ids: string[];
  control: CombinedScore[];
  treatment: CombinedScore[];
}

export async function runAbEvaluation(
  opts: AbRunOptions,
): Promise<AbRunResult> {
  const startedAt = new Date().toISOString();
  const allPrompts = loadPrompts(opts.promptsDir);
  const prompts =
    opts.maxPrompts !== undefined && opts.maxPrompts < allPrompts.length
      ? allPrompts.slice(0, opts.maxPrompts)
      : allPrompts;
  const runsPerCondition = opts.runsPerCondition ?? 1;
  const skeletonMode = opts.skeletonMode ?? true;
  const perPrompt: AbPromptResult[] = [];

  // Ensure the output directory exists up front so incremental writes
  // (one per completed prompt) don't fail later.
  fs.mkdirSync(path.dirname(opts.outputFile), { recursive: true });

  for (const prompt of prompts) {
    const controlScores: CombinedScore[] = [];
    const treatmentScores: CombinedScore[] = [];

    for (let i = 0; i < runsPerCondition; i++) {
      const controlScore = await runOne(
        prompt,
        opts.controlAdapter,
        skeletonMode,
      );
      controlScores.push(controlScore);
      opts.onProgress?.({
        prompt_id: prompt.id,
        condition: 'control',
        run_index: i,
        total_runs: runsPerCondition,
        overall_score: controlScore.overall_score,
        usage: controlScore.usage,
      });

      const treatmentScore = await runOne(
        prompt,
        opts.treatmentAdapter,
        skeletonMode,
      );
      treatmentScores.push(treatmentScore);
      opts.onProgress?.({
        prompt_id: prompt.id,
        condition: 'treatment',
        run_index: i,
        total_runs: runsPerCondition,
        overall_score: treatmentScore.overall_score,
        usage: treatmentScore.usage,
      });
    }

    perPrompt.push({
      prompt_id: prompt.id,
      domain: prompt.domain,
      card_ids: prompt.card_ids,
      control: controlScores,
      treatment: treatmentScores,
    });

    // Incremental write — survives mid-run crashes (e.g. quota
    // exhaustion). Stats are recomputed on the fly so the partial
    // file is self-consistent at every point.
    writePartial(opts.outputFile, {
      run_started_at: startedAt,
      control_model_id: opts.controlAdapter.id,
      treatment_model_id: opts.treatmentAdapter.id,
      runs_per_condition: runsPerCondition,
      perPrompt,
    });
  }

  const controlStats = aggregateRuns(perPrompt.map((p) => p.control));
  const treatmentStats = aggregateRuns(perPrompt.map((p) => p.treatment));

  const controlByPrompt = perPrompt.map((p) => p.control);
  const treatmentByPrompt = perPrompt.map((p) => p.treatment);
  const pairedOverall = pairedTTest(controlByPrompt, treatmentByPrompt, 'overall_score');
  const pairedFunctional = pairedTTest(controlByPrompt, treatmentByPrompt, 'functional_pass_rate');

  const pairedDelta = {
    mean_overall_score_delta: pairedOverall.mean_delta,
    mean_functional_pass_rate_delta: pairedFunctional.mean_delta,
    n_prompts: perPrompt.length,
  };

  const result: AbRunResult = {
    run_started_at: startedAt,
    control_model_id: opts.controlAdapter.id,
    treatment_model_id: opts.treatmentAdapter.id,
    prompts_evaluated: perPrompt.length,
    runs_per_condition: runsPerCondition,
    per_prompt: perPrompt,
    control_stats: controlStats,
    treatment_stats: treatmentStats,
    paired_delta: pairedDelta,
    paired_t_test: {
      overall_score: pairedOverall,
      functional_pass_rate: pairedFunctional,
    },
  };

  fs.writeFileSync(opts.outputFile, JSON.stringify(result, null, 2));
  return result;
}

/** Same shape as AbRunResult but recomputed from the current per-prompt
 *  slice — used for incremental on-disk writes so a crash mid-run still
 *  leaves a self-consistent partial result for inspection. */
function writePartial(
  outputFile: string,
  partial: {
    run_started_at: string;
    control_model_id: string;
    treatment_model_id: string;
    runs_per_condition: number;
    perPrompt: AbPromptResult[];
  },
): void {
  const controlStats = aggregateRuns(partial.perPrompt.map((p) => p.control));
  const treatmentStats = aggregateRuns(partial.perPrompt.map((p) => p.treatment));
  const controlByPrompt = partial.perPrompt.map((p) => p.control);
  const treatmentByPrompt = partial.perPrompt.map((p) => p.treatment);
  const pairedOverall = pairedTTest(controlByPrompt, treatmentByPrompt, 'overall_score');
  const pairedFunctional = pairedTTest(controlByPrompt, treatmentByPrompt, 'functional_pass_rate');
  const result: AbRunResult & { partial: boolean } = {
    run_started_at: partial.run_started_at,
    control_model_id: partial.control_model_id,
    treatment_model_id: partial.treatment_model_id,
    prompts_evaluated: partial.perPrompt.length,
    runs_per_condition: partial.runs_per_condition,
    per_prompt: partial.perPrompt,
    control_stats: controlStats,
    treatment_stats: treatmentStats,
    paired_delta: {
      mean_overall_score_delta: pairedOverall.mean_delta,
      mean_functional_pass_rate_delta: pairedFunctional.mean_delta,
      n_prompts: partial.perPrompt.length,
    },
    paired_t_test: {
      overall_score: pairedOverall,
      functional_pass_rate: pairedFunctional,
    },
    // `partial: true` is overwritten with `false` only on full success
    // (the final writeFileSync at the end of runAbEvaluation doesn't
    // include this field, signalling completeness).
    partial: true,
  };
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2));
}

async function runOne(
  prompt: PromptDefinition,
  adapter: ModelAdapter,
  skeletonMode: boolean,
): Promise<CombinedScore> {
  const { candidate, usage, trace } = await adapter.generate(prompt);
  const functional = await scoreFunctional(prompt, candidate, { skeletonMode });
  const verification = await scoreVerification(prompt, candidate);
  const base = combine(prompt, functional, verification);
  return {
    ...base,
    candidate,
    ...(usage ? { usage } : {}),
    ...(trace ? { trace } : {}),
  };
}

function loadPrompts(dir: string): PromptDefinition[] {
  // Sort lexicographically so a subset slice (--max-prompts N) is
  // reproducible across runs regardless of filesystem ordering.
  const entries = fs.readdirSync(dir).filter((e) => e.endsWith('.json')).sort();
  const out: PromptDefinition[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const json = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
    out.push(json as PromptDefinition);
  }
  return out;
}
