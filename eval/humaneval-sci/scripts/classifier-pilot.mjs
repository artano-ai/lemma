#!/usr/bin/env node
/*
 * classifier-pilot.mjs
 *
 * Tests whether a cheap Llama 3.1 8B self-classifier can predict its
 * own positive-flip vs negative-flip prompts on the
 * 2026-05-21-llama3.1-8b-73prompt-trace landmark.
 *
 * Methodology:
 *   1. Load the 73-prompt landmark JSON.
 *   2. For each prompt, derive a ground-truth binary label:
 *        invoke_treatment = (treatment_score >= control_score)
 *      Positive-flip and neutral prompts get label=true (it's OK or
 *      good to use the substrate); negative-flip prompts get label=false.
 *   3. For each prompt, call Ollama llama3.1:8b with a classifier
 *      prompt that asks the model to self-assess whether it can
 *      produce correct code without an external lookup. Parse YES/NO.
 *   4. Compute accuracy, precision, recall, F1, confusion matrix.
 *   5. Counterfactual: if we routed based on the classifier output,
 *      what would the per-prompt aggregate look like? Compare against:
 *        - all-control baseline (current Δ = 0 by definition)
 *        - all-treatment baseline (current Δ = -0.220)
 *        - oracle routing using ground truth
 *
 * Usage:
 *   node scripts/classifier-pilot.mjs <landmark.json> [--max N] [--model M]
 *
 * Output:
 *   results/classifier-pilot-<ts>.json — per-prompt predictions + metrics
 *   stdout — human-readable summary
 */
import fs from 'node:fs';
import path from 'node:path';
import { argv } from 'node:process';

const args = argv.slice(2);
const landmarkPath = args.find((a) => !a.startsWith('--'));
const maxFlag = args.indexOf('--max');
const modelFlag = args.indexOf('--model');
const MAX = maxFlag >= 0 ? parseInt(args[maxFlag + 1], 10) : Infinity;
const MODEL = modelFlag >= 0 ? args[modelFlag + 1] : 'llama3.1:8b';
const BASE_URL = 'http://127.0.0.1:11434/v1';

if (!landmarkPath) {
  console.error('Usage: classifier-pilot.mjs <landmark.json> [--max N] [--model M]');
  process.exit(1);
}

// Two classifier variants. The original (`v1-conservative`) hard-coded
// "bias toward false" which collapsed to all-NO in the pilot run. The
// new `v2-neutral` removes that instruction and asks for a calibrated
// self-assessment with explicit reasoning about the most-likely error.
// Switch via --variant.
const CLASSIFIER_SYSTEM_V1_CONSERVATIVE = `You are a code-generation triage classifier. Given a scientific code task, decide whether you (an 8B-parameter open-weights Python coder) need to look up an external reference card containing the formula, constants, and validation bounds for the task — or whether you already have the knowledge in your weights to produce numerically and physically correct code without help.

Reply with a single JSON object on one line, no markdown fences, no extra text:
{"needs_lookup": true|false, "reason": "<one short sentence>"}

needs_lookup=true means you would benefit from the reference card.
needs_lookup=false means you can produce correct code unaided.

Bias toward needs_lookup=false unless the task involves an obscure constant, an easy-to-misremember coefficient, or a non-textbook formula. Routine textbook recipes (Coulomb's law, Arrhenius, ideal gas law, basic finite differences) do NOT need lookup.`;

const CLASSIFIER_SYSTEM_V2_NEUTRAL = `You are a code-generation triage classifier. Given a scientific code task, you will be asked to predict whether YOUR OWN unaided attempt to write the requested function will pass numeric test cases.

For each task, do an honest internal self-assessment:
1. Identify the principal formula, constants, and units the task requires.
2. Estimate the probability that, writing from your weights alone, you will (a) pick the correct formula, (b) use the correct numerical coefficient with the right exponent, (c) get the units consistent, and (d) handle edge cases as the task specifies.
3. If you have HIGH confidence on all four, predict you do NOT need a lookup. If you have LOW confidence on any one, predict you DO need a lookup.

Reply with a single JSON object on one line, no markdown fences, no extra text:
{"needs_lookup": true|false, "reason": "<one short sentence naming the most likely source of error if any>"}

needs_lookup=true means you have non-trivial uncertainty about the formula, a constant, the units, or the edge cases.
needs_lookup=false means you are confident on all four.

Do NOT default either way. Some tasks are routine and you should say false; others involve subtle conventions or non-textbook coefficients and you should say true. Be honest about your own uncertainty.`;

const variantIdx = args.indexOf('--variant');
const VARIANT = variantIdx >= 0 ? args[variantIdx + 1] : 'v2-neutral';
const CLASSIFIER_SYSTEM =
  VARIANT === 'v1-conservative'
    ? CLASSIFIER_SYSTEM_V1_CONSERVATIVE
    : CLASSIFIER_SYSTEM_V2_NEUTRAL;
console.warn(`Classifier variant: ${VARIANT}`);

const run = JSON.parse(fs.readFileSync(landmarkPath, 'utf-8'));
const allPrompts = run.per_prompt.slice(0, MAX);
console.warn(`Loaded ${allPrompts.length} prompts from ${path.basename(landmarkPath)}`);

const predictions = [];
const startedAt = new Date().toISOString();

for (const p of allPrompts) {
  const promptText = await loadPromptText(p.prompt_id);
  const t0 = Date.now();
  let pred = null;
  let raw = '';
  try {
    const resp = await callOllama({
      model: MODEL,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM },
        { role: 'user', content: `Task ID: ${p.prompt_id}\nDomain: ${p.domain}\n\nTask:\n${promptText}` },
      ],
    });
    raw = resp.choices?.[0]?.message?.content ?? '';
    pred = parseClassifierOutput(raw);
  } catch (err) {
    console.warn(`  [${p.prompt_id}] error: ${err.message}`);
  }
  const dt = Date.now() - t0;
  const c = p.control[0].overall_score;
  const t = p.treatment[0].overall_score;
  const delta = t - c;
  const ground_truth = delta >= 0; // true = OK or good to use treatment
  const correct = pred?.needs_lookup === ground_truth;
  predictions.push({
    prompt_id: p.prompt_id,
    domain: p.domain,
    control_score: c,
    treatment_score: t,
    delta,
    ground_truth_invoke: ground_truth,
    classifier_needs_lookup: pred?.needs_lookup ?? null,
    classifier_reason: pred?.reason ?? null,
    correct,
    raw_response: raw,
    elapsed_ms: dt,
  });
  console.warn(
    `  [${predictions.length}/${allPrompts.length}] ${p.prompt_id.padEnd(45)} ` +
      `gt=${ground_truth ? 'YES' : 'NO '} pred=${pred?.needs_lookup === true ? 'YES' : pred?.needs_lookup === false ? 'NO ' : '???'} ${correct ? '✓' : '✗'}  (Δ=${delta.toFixed(2)}, ${dt}ms)`,
  );
}

// --- Metrics ---
const tp = predictions.filter((p) => p.ground_truth_invoke && p.classifier_needs_lookup === true).length;
const tn = predictions.filter((p) => !p.ground_truth_invoke && p.classifier_needs_lookup === false).length;
const fp = predictions.filter((p) => !p.ground_truth_invoke && p.classifier_needs_lookup === true).length;
const fn = predictions.filter((p) => p.ground_truth_invoke && p.classifier_needs_lookup === false).length;
const n = predictions.filter((p) => p.classifier_needs_lookup !== null).length;
const acc = (tp + tn) / Math.max(n, 1);
const prec = tp / Math.max(tp + fp, 1);
const rec  = tp / Math.max(tp + fn, 1);
const f1   = (prec + rec > 0) ? 2 * prec * rec / (prec + rec) : 0;

// Counterfactual aggregate scores under different routing policies
function routedScore(pred, mode) {
  // For each prompt, pick T or C depending on the policy. Return aggregate mean.
  return predictions.reduce((s, p) => {
    let useT = false;
    if (mode === 'all-control')        useT = false;
    else if (mode === 'all-treatment') useT = true;
    else if (mode === 'oracle')        useT = p.ground_truth_invoke;
    else if (mode === 'classifier')    useT = p.classifier_needs_lookup === true;
    return s + (useT ? p.treatment_score : p.control_score);
  }, 0) / predictions.length;
}
const score_ctrl  = routedScore(null, 'all-control');
const score_trt   = routedScore(null, 'all-treatment');
const score_oracle = routedScore(null, 'oracle');
const score_classifier = routedScore(null, 'classifier');

const summary = {
  run_started_at: startedAt,
  landmark: path.basename(landmarkPath),
  classifier_model: MODEL,
  classifier_variant: VARIANT,
  n_prompts: predictions.length,
  confusion_matrix: { TP: tp, TN: tn, FP: fp, FN: fn, missing: predictions.length - n },
  metrics: {
    accuracy: acc,
    precision: prec,
    recall: rec,
    f1,
    chance_baseline: (tp + fn) / Math.max(n, 1),  // if classifier always said "YES"
  },
  aggregate_scores: {
    all_control: score_ctrl,
    all_treatment: score_trt,
    oracle_routing: score_oracle,
    classifier_routing: score_classifier,
  },
  delta_vs_control: {
    all_treatment: score_trt - score_ctrl,
    oracle_routing: score_oracle - score_ctrl,
    classifier_routing: score_classifier - score_ctrl,
  },
  predictions,
};

const outPath = `results/classifier-pilot-${startedAt.replace(/[:.]/g, '-')}.json`;
fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

console.log('\n=== Classifier pilot summary ===');
console.log(`n prompts evaluated:           ${predictions.length}`);
console.log(`confusion matrix:              TP=${tp} TN=${tn} FP=${fp} FN=${fn} (missing=${predictions.length - n})`);
console.log(`accuracy:                      ${acc.toFixed(3)}`);
console.log(`precision:                     ${prec.toFixed(3)}  (of predicted YES, fraction correct)`);
console.log(`recall:                        ${rec.toFixed(3)}  (of true YES, fraction caught)`);
console.log(`F1:                            ${f1.toFixed(3)}`);
console.log(`always-YES baseline accuracy:  ${((tp + fn) / n).toFixed(3)}`);
console.log('');
console.log('Counterfactual aggregate score (mean over n prompts):');
console.log(`  all-control  (no tools):      ${score_ctrl.toFixed(3)}`);
console.log(`  all-treatment (current v0.1): ${score_trt.toFixed(3)}  (Δ vs C = ${(score_trt - score_ctrl).toFixed(3)})`);
console.log(`  oracle routing (perfect):     ${score_oracle.toFixed(3)}  (Δ vs C = ${(score_oracle - score_ctrl).toFixed(3)})`);
console.log(`  classifier routing (this run):${score_classifier.toFixed(3)}  (Δ vs C = ${(score_classifier - score_ctrl).toFixed(3)})`);
console.log('');
console.log(`Output: ${outPath}`);

// ---------------------------------------------------------------------------

async function loadPromptText(promptId) {
  const promptsDir = process.env.HUMANEVAL_SCI_PROMPTS_DIR ?? 'prompts';
  const p = path.join(promptsDir, `${promptId}.json`);
  if (!fs.existsSync(p)) return '(prompt JSON not found)';
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return j.prompt;
}

async function callOllama(body) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function parseClassifierOutput(raw) {
  // Extract first {...} JSON object from text — robust to surrounding chatter.
  const m = raw.match(/\{[^{}]*"needs_lookup"\s*:\s*(true|false)[^{}]*\}/i);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (typeof obj.needs_lookup !== 'boolean') return null;
    return { needs_lookup: obj.needs_lookup, reason: obj.reason ?? '' };
  } catch {
    return null;
  }
}
