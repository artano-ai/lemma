// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Outcomes and their score penalties.
 *
 * The engine draws a distinction its own verdicts depend on: "I could not
 * check this" is not "I checked this and it is wrong". `require_checks` exists
 * precisely so a run with zero checks cannot pass silently. This module is
 * where the scorer stops violating that distinction.
 *
 * `UNCHECKED` is a declined check: recorded, not discharged, and carrying no
 * evidence either way. It costs nothing. `LOW` is a real finding that happens
 * to be minor, and keeps its penalty.
 *
 * Why this matters arithmetically: under the previous single scale a declined
 * check was charged as `LOW = 0.25`, so functionally-perfect code carrying one
 * undischarged claim scored `1.0 x 0.75 = 0.75` and 1.0 was unreachable. Every
 * number produced before METRIC_VERSION 2 was measured against that ceiling.
 */

/**
 * Scoring metric version. Bumped whenever the mapping from verdict to score
 * changes, because that makes previously published numbers incomparable.
 *
 *   1 — declined checks charged as LOW (0.25). Ceiling 0.75.
 *   2 — declined checks are UNCHECKED (0.0) and reported separately.
 */
export const METRIC_VERSION = 2;

export type Finding = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
export type Outcome = Finding | 'UNCHECKED';

export const PENALTY: Record<Outcome, number> = {
  UNCHECKED: 0.0,
  NONE: 0.0,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 1.0,
};

/** Penalties as they stood at METRIC_VERSION 1, kept so a run can report both
 *  scales side by side rather than silently re-baselining published numbers. */
export const PENALTY_V1: Record<Outcome, number> = {
  UNCHECKED: 0.25,
  NONE: 0.0,
  LOW: 0.25,
  MEDIUM: 0.5,
  HIGH: 1.0,
};

const SEVERITY_ORDER: Finding[] = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];

export function isFinding(o: Outcome): o is Finding {
  return o !== 'UNCHECKED';
}

/**
 * Worst finding across a set of outcomes. Declines contribute nothing: they
 * carry no evidence, so they can neither raise nor lower the verdict. An
 * all-declined set aggregates to NONE — the absence of findings — with the
 * *count* of declines reported separately so coverage stays visible rather
 * than being laundered into the score.
 */
export function aggregateOutcomes(outcomes: readonly Outcome[]): Finding {
  let worst: Finding = 'NONE';
  for (const o of outcomes) {
    if (!isFinding(o)) continue;
    if (SEVERITY_ORDER.indexOf(o) > SEVERITY_ORDER.indexOf(worst)) worst = o;
  }
  return worst;
}

export function countDeclines(outcomes: readonly Outcome[]): number {
  return outcomes.filter((o) => !isFinding(o)).length;
}

/**
 * Check names that report the harness *declining to run*, rather than a
 * finding it made. These are the differential scorer's declines; the
 * hypothesis engine signals its own declines with `warn`, which is mapped at
 * the call site.
 *
 * `differential.setup` fires when no function name could be extracted, so no
 * probe ever ran — evidence-free, and the exact shape of a decline. It sat at
 * LOW alongside `differential.summary`, which fires when probes *did* run and
 * 70-95% matched the reference. That one is a real, minor finding and keeps
 * its penalty. Two different events wearing the same clothes.
 */
const DECLINE_CHECKS = new Set(['differential.setup']);

export function isDecline(checkName: string): boolean {
  return DECLINE_CHECKS.has(checkName);
}
