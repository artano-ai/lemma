// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Re-score an archived run record under METRIC_VERSION 2 and report both
 * scales side by side.
 *
 * Run: node scripts/rescore-metric-v2.mjs <record.json> [...]
 *
 * Costs no inference: run records carry each candidate's full verification
 * `details`, so the verdict can be re-aggregated offline. Nothing here
 * re-runs a model or the engine.
 *
 * v1 charged a declined check as LOW (0.25), so a candidate carrying any
 * undischarged claim could not exceed 0.75. v2 separates declines
 * (UNCHECKED, free) from findings (LOW, still 0.25) and counts declines
 * separately. Reclassification is done from the check *name*, because that
 * is what the archived record preserves.
 *
 * Deliberately NOT corrected here: `differential.import_failure`. It is a
 * separate defect with a separate cause, and folding the two together would
 * reproduce exactly the confounded attribution that cost this programme a
 * day. It is reported on its own below.
 */

import fs from 'node:fs';
import path from 'node:path';

const PENALTY_V1 = { NONE: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 };
const PENALTY_V2 = { NONE: 0, UNCHECKED: 0, LOW: 0.25, MEDIUM: 0.5, HIGH: 1.0 };
const ORDER = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];

/** A check the engine/harness declined to run, rather than a finding it made. */
function isDecline(name) {
  return (
    name.startsWith('Hypothesis.limit_') ||
    name.startsWith('Hypothesis.conservation_') ||
    name === 'differential.setup'
  );
}

/**
 * Reproduce v1's aggregation EXACTLY. Not "max over detail lines": the engine
 * contributes its own overall (anyFail -> HIGH, anyWarn -> LOW, else NONE) and
 * the differential contributes its pass-rate-banded aggregate, which is the
 * `differential.summary` line — not the per-probe MEDIUM lines beneath it.
 * Taking the max over all details instead disagrees on 11 of 1095 archived
 * candidates. Verified: this reconstruction reproduces the stored
 * `overall_score` on all 1095 with zero mismatches.
 */
function v1Severity(details) {
  let engine = 'NONE';
  for (const d of details) {
    if (!d.name.startsWith('Hypothesis.')) continue;
    if (d.severity === 'HIGH') engine = 'HIGH';
    else if (d.severity === 'LOW' && engine !== 'HIGH') engine = 'LOW';
  }
  let diff = null;
  for (const d of details) if (d.name === 'differential.summary') diff = d.severity;
  if (diff === null) {
    for (const d of details) {
      if (EARLY_RETURN.has(d.name)) diff = d.severity;
    }
  }
  if (diff === null) return engine;
  return ORDER.indexOf(engine) >= ORDER.indexOf(diff) ? engine : diff;
}

const EARLY_RETURN = new Set([
  'differential.setup',
  'differential.no_probes',
  'differential.import_failure',
]);

/** v2: same shape, but declines are removed before aggregating and counted. */
function v2Severity(details) {
  const kept = details.filter((d) => !isDecline(d.name));
  let declines = details.length - kept.length;
  return { severity: v1Severity(kept), declines };
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function rescore(record) {
  const v1 = [];
  const v2 = [];
  let totalDeclines = 0;
  let candidates = 0;
  let importFailures = 0;
  let drift = 0;
  const distV1 = {};
  const distV2 = {};

  for (const p of record.per_prompt ?? []) {
    for (const s of p.samples ?? []) {
      candidates++;
      const details = s.verification?.details ?? [];
      const rate = s.functional?.pass_rate ?? 0;

      const sev1 = v1Severity(details);
      const a2 = v2Severity(details);
      totalDeclines += a2.declines;
      if (details.some((d) => d.name === 'differential.import_failure')) {
        importFailures++;
      }

      distV1[sev1] = (distV1[sev1] ?? 0) + 1;
      distV2[a2.severity] = (distV2[a2.severity] ?? 0) + 1;
      v1.push(rate * (1 - PENALTY_V1[sev1]));
      v2.push(rate * (1 - PENALTY_V2[a2.severity]));
      // Guard: v1 must reproduce the archived score. If it does not, the
      // reconstruction is wrong and the v2 delta below is meaningless.
      if (Math.abs(rate * (1 - PENALTY_V1[sev1]) - (s.overall_score ?? 0)) > 1e-9) {
        drift++;
      }
    }
  }
  return { v1, v2, totalDeclines, candidates, importFailures, distV1, distV2, drift };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/rescore-metric-v2.mjs <record.json> [...]');
  process.exit(2);
}

for (const f of files) {
  const record = JSON.parse(fs.readFileSync(f, 'utf-8'));
  const r = rescore(record);
  const m1 = mean(r.v1);
  const m2 = mean(r.v2);
  const ceil1 = Math.max(...r.v1);
  const ceil2 = Math.max(...r.v2);
  const perfect1 = r.v1.filter((x) => x === 1).length;
  const perfect2 = r.v2.filter((x) => x === 1).length;

  console.log(`\n${path.basename(f)}`);
  console.log(`  model ${record.model ?? '?'} · ${r.candidates} candidates`);
  console.log(`  ${''.padEnd(22)}${'v1'.padStart(8)}${'v2'.padStart(9)}`);
  console.log(`  ${'mean overall'.padEnd(22)}${m1.toFixed(3).padStart(8)}${m2.toFixed(3).padStart(9)}   Δ ${(m2 - m1>=0?'+':'')}${(m2 - m1).toFixed(3)}`);
  console.log(`  ${'best candidate'.padEnd(22)}${ceil1.toFixed(3).padStart(8)}${ceil2.toFixed(3).padStart(9)}`);
  console.log(`  ${'candidates at 1.0'.padEnd(22)}${String(perfect1).padStart(8)}${String(perfect2).padStart(9)}`);
  console.log(`  declines reclassified: ${r.totalDeclines} (${(r.totalDeclines / r.candidates).toFixed(2)}/candidate)`);
  console.log(`  severity v1: ${JSON.stringify(r.distV1)}`);
  console.log(`  severity v2: ${JSON.stringify(r.distV2)}`);
  console.log(
    drift_line(r.drift),
  );
  if (r.importFailures) {
    console.log(
      `  ⚠ ${r.importFailures} candidates carry differential.import_failure — NOT corrected here`,
    );
  }
}

function drift_line(drift) {
  return drift === 0
    ? '  v1 reconstruction reproduces every archived overall_score (0 drift)'
    : `  ✗ v1 reconstruction DRIFTS on ${drift} candidates — v2 delta is not trustworthy`;
}
