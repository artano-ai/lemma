// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Verification scorer — runs the real Lemma cross-check engine on the
 * scientific claims declared in a prompt's `verification_targets`,
 * keyed against the cards in `card_ids`.
 *
 * Strategy: synthesise an in-memory HypothesisCard from the prompt's
 * verification_targets, then call `runHypothesisChecks` from the
 * cards engine. The HypothesisCard mirrors what an LLM would propose
 * if it were generating a new card for this principle — which is
 * exactly the equivalence we want to test.
 *
 * v0 limitations:
 *   - We don't extract claims from the candidate code itself yet; we
 *     verify the *prompt's declared targets*, treating the model's
 *     code as opaque. Real claim extraction (parse the code, recover
 *     the implied formula, compare to the card's formulaTeX) is a
 *     v0.2 deliverable.
 *   - `limits` and `conservation_laws` checks today flow through the
 *     engine as `severity: 'warn'` (claim-recorded). Real symbolic
 *     verification via SymPy / PySR is on the engine roadmap.
 */
import { runHypothesisChecks } from '../../../mcp-server/src/cards/checks.js';
import { ALL_CARDS } from '../../../mcp-server/src/cards/loader.js';
import {
  scoreDifferential,
  type DifferentialOptions,
} from './differential.js';
import type {
  CombinedScore,
  FunctionalScore,
  PromptDefinition,
  Severity,
  VerificationScore,
} from './types.js';
import type {
  ConservationLawSpec,
  HypothesisCard,
  LimitCheckSpec,
} from '../../../mcp-server/src/cards/types.js';

const SEVERITY_ORDER: Severity[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

const SEVERITY_PENALTY: Record<Severity, number> = {
  NONE: 0.0,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 1.0,
};

const ENGINE_TO_SEVERITY: Record<string, Severity> = {
  pass: 'NONE',
  warn: 'LOW',
  fail: 'HIGH',
};

const KNOWN_CONSERVATION_LAWS: ConservationLawSpec['law'][] = [
  'energy',
  'momentum',
  'charge',
  'particle-number',
  'total-spin',
  'parity',
];

export interface VerificationScoreOptions {
  /** Reserved for future symbolic-check toggles. The real engine is
   *  used either way; this option is forward-compatible with a
   *  SymPy / PySR adapter that promotes 'warn' limit / conservation
   *  claims to pass/fail. */
  symbolicVerification?: boolean;
  /** When the candidate code is provided, run a differential check
   *  (candidate vs reference on a probe sweep) and merge the result
   *  into the verification verdict. This is what makes verification
   *  differentiate between control and treatment arms — without
   *  candidate code, the verdict only reflects the prompt's
   *  pre-declared targets and is identical across arms. */
  differential?: DifferentialOptions;
}

/**
 * Build an in-memory HypothesisCard from a prompt's verification
 * targets so the same engine that scores hypothesis-card promotions
 * can score eval-harness prompts. Reuses the engine's existing
 * dimensional / reference-corpus / limit / conservation-law check
 * primitives without re-implementing them.
 */
export function buildHypothesisFromPrompt(
  prompt: PromptDefinition,
): HypothesisCard {
  const targets = prompt.verification_targets;
  const limits: LimitCheckSpec[] = (targets.limits ?? []).map((stmt, idx) => ({
    name: `limit_${idx}`,
    regime: stmt,
    expectedReducesTo: stmt,
  }));
  const conservationLaws: ConservationLawSpec[] = (targets.conservation_laws ?? [])
    .filter((law): law is ConservationLawSpec['law'] =>
      (KNOWN_CONSERVATION_LAWS as string[]).includes(law),
    )
    .map((law) => ({
      law,
      statement: `${law} conservation declared by eval-harness prompt ${prompt.id}.`,
    }));

  return {
    kind: 'hypothesis',
    id: `eval-prompt-${prompt.id}`,
    version: '0.0.1',
    name: `Eval-harness wrapper for prompt ${prompt.id}`,
    proposal: prompt.prompt,
    proposedFormulaTeX: '',
    derivedFrom:
      prompt.card_ids.length > 0
        ? { cardId: prompt.card_ids[0]!, relationship: 'extends' }
        : undefined,
    checks: {
      ...(targets.dimensional
        ? {
            dimensional: {
              lhsLabel: targets.dimensional.lhs_label,
              lhsDims: targets.dimensional.lhs_dims,
              rhsLabel: targets.dimensional.rhs_label,
              rhsDims: targets.dimensional.rhs_dims,
            },
          }
        : {}),
      ...(limits.length > 0 ? { limits } : {}),
      ...(conservationLaws.length > 0 ? { conservationLaws } : {}),
      ...(prompt.card_ids.length > 0
        ? { referenceCorpus: { mustAgreeWith: prompt.card_ids } }
        : {}),
    },
    references: [],
    origin: 'human',
  };
}

/**
 * Score verification for a prompt. When `candidateCode` is provided,
 * also runs a differential probe sweep (candidate vs reference) and
 * folds the result into the verdict — this is what makes verification
 * differentiate between A/B arms.
 *
 * When `candidateCode` is omitted, returns the legacy claim-only
 * verdict that depends solely on the prompt's pre-declared targets
 * (used by tests and the single-arm runner before the candidate is
 * generated).
 */
export async function scoreVerification(
  prompt: PromptDefinition,
  candidateCode?: string,
  options: VerificationScoreOptions = {},
): Promise<VerificationScore> {
  const hypothesis = buildHypothesisFromPrompt(prompt);
  const verdict = runHypothesisChecks(hypothesis, { corpus: ALL_CARDS });

  const details = verdict.checks.map((c) => ({
    name: c.name,
    severity: (ENGINE_TO_SEVERITY[c.severity] ?? 'LOW') as Severity,
    detail: c.detail,
  }));

  let severity = mapEngineSeverity(verdict.overall.severity);
  let passing = verdict.overall.passing;
  let total = verdict.overall.total;

  if (candidateCode !== undefined) {
    const diff = await scoreDifferential(
      prompt,
      candidateCode,
      options.differential ?? {},
    );
    for (const d of diff.details) {
      details.push({ name: d.name, severity: d.severity, detail: d.detail });
    }
    severity = maxSeverity(severity, diff.severity);
    passing += diff.passing;
    total += diff.total;
  }

  return { severity, passing, total, details };
}

export function combine(
  prompt: PromptDefinition,
  functional: FunctionalScore,
  verification: VerificationScore,
): CombinedScore {
  const penalty = SEVERITY_PENALTY[verification.severity];
  const overall = functional.pass_rate * (1 - penalty);
  return {
    prompt_id: prompt.id,
    card_ids: prompt.card_ids,
    functional,
    verification,
    overall_score: overall,
  };
}

function mapEngineSeverity(
  engineSeverity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH',
): Severity {
  return engineSeverity;
}
