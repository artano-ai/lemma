// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma verify` — range-check a finished numeric output against a principle
 * card's validation envelopes.
 *
 * This is the capability neither runtime had before: the engine could be
 * called from Python, from Node, or over MCP, but not from a shell. Which
 * meant it could not sit in a CI pipeline, which is the one place a
 * verification gate earns its keep.
 *
 * ## Exit codes are the actual product here
 *
 * A CI step is graded on its exit status, not its stdout. So:
 *
 * * `0` — every check passed
 * * `1` — the engine returned a HIGH severity: something is out of range
 * * `2` — the command could not run at all (bad card id, unreadable JSON)
 *
 * Separating 1 from 2 matters. A pipeline that treats "the physics is wrong"
 * and "you typed the card id wrong" as the same red build teaches people to
 * ignore the red build.
 *
 * ## `--require-checks`
 *
 * Off by default, matching the engine. An output key with no declared envelope
 * is simply not checked, so a run can exit 0 having verified nothing at all.
 * `--require-checks` turns that silence into a HIGH finding. It is the flag to
 * reach for in CI, and the reason it is not the default is that flipping it
 * would change what every existing green build means.
 */

import { readFileSync } from 'node:fs';
import {
  findPrincipleCard,
  runConvergenceCheck,
  runSeriesChecks,
  runUsceChecks,
  type ConvergencePoint,
} from '@artano-ai/mcp-server/engine';
import { bold, checkMark, cyan, dim, emitJson, red, severityColor, type Severity } from '../render.js';
import { CliError } from '../errors.js';

export interface VerifyOptions {
  cardId: string;
  output?: string;
  outputFile?: string;
  /** Columns of one table: quantity -> samples. Checked against the card's `seriesConditions`. */
  seriesFile?: string;
  /** `[h, error]` refinement levels. Checked against the card's declared convergence order. */
  refinementFile?: string;
  requireChecks: boolean;
  json: boolean;
}

/** Read and parse a JSON file, or stdin when the path is `-`. */
function readJson(path: string, label: string): unknown {
  let raw: string;
  try {
    raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  } catch (err) {
    throw new CliError(`Cannot read ${label} from ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliError(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

function readSeries(path: string): Record<string, number[]> {
  const parsed = readJson(path, 'series data');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Series data must be a JSON object mapping each quantity to its samples.');
  }
  const out: Record<string, number[]> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'number')) {
      throw new CliError(`Series "${key}" must be an array of numbers.`);
    }
    out[key] = value as number[];
  }
  return out;
}

function readRefinement(path: string): ConvergencePoint[] {
  const parsed = readJson(path, 'refinement study');
  if (
    !Array.isArray(parsed) ||
    parsed.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number'))
  ) {
    throw new CliError(
      'A refinement study must be an array of [h, error] pairs, e.g. [[0.1, 1e-3], [0.05, 2.5e-4]].',
    );
  }
  return parsed as ConvergencePoint[];
}

/** Parse the `--output` payload: inline JSON, a file, or stdin via `-`. */
function readOutput(opts: VerifyOptions): Record<string, number> {
  let raw: string;
  if (opts.outputFile) {
    raw = opts.outputFile === '-' ? readFileSync(0, 'utf8') : readFileSync(opts.outputFile, 'utf8');
  } else if (opts.output) {
    raw = opts.output;
  } else {
    throw new CliError('Provide the output to check with --output \'{"key": 1.23}\' or --output-file <path|->.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(`Output is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliError('Output must be a JSON object mapping envelope keys to numbers.');
  }

  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      // Refuse rather than coerce. A string "9.81" that silently became a
      // number would make the verdict depend on a conversion the user never
      // asked for, and a NaN would compare false against every bound and
      // report as in-range on some paths.
      throw new CliError(
        `Output key "${key}" is ${JSON.stringify(value)}; every value must be a finite number.`,
      );
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) {
    throw new CliError('Output is empty — there is nothing to check.');
  }
  return out;
}

export function verify(opts: VerifyOptions): number {
  const card = findPrincipleCard(opts.cardId);
  if (!card) {
    throw new CliError(
      `Unknown principle card: "${opts.cardId}". Run \`lemma cards list\` to see every card.`,
    );
  }

  // A run may present several shapes of evidence at once — scalars against
  // envelopes, series against sign conditions, a refinement study against a
  // declared order. They are reported as one verdict because they describe one
  // run; splitting them into separate invocations would make a pipeline decide
  // which failures matter.
  const sections: { label: string; result: ReturnType<typeof runUsceChecks> }[] = [];

  if (opts.output || opts.outputFile) {
    sections.push({ label: 'envelopes', result: runUsceChecks(readOutput(opts), card, opts.requireChecks) });
  }
  if (opts.seriesFile) {
    sections.push({ label: 'series', result: runSeriesChecks(readSeries(opts.seriesFile), card) });
  }
  if (opts.refinementFile) {
    sections.push({
      label: 'convergence',
      result: runConvergenceCheck(readRefinement(opts.refinementFile), card),
    });
  }
  if (sections.length === 0) {
    throw new CliError(
      "Nothing to check. Pass --output '{\"key\": 1.23}', --output-file <path|->, " +
        '--series <path> or --refinement <path>.',
    );
  }

  const checks = sections.flatMap((s) => s.result.checks);
  const passing = checks.filter((c) => c.severity === 'pass').length;
  // Aggregate from each section's OVERALL severity, not from the checks. With
  // `--require-checks` the engine reports HIGH on a run with *zero* checks —
  // that is the entire point of the flag — so deriving severity from the check
  // list alone silently drops it.
  const severity: Severity = sections.some((s) => s.result.overall.severity === 'HIGH')
    ? 'HIGH'
    : 'NONE';

  if (opts.json) {
    emitJson({
      card: card.id,
      requireChecks: opts.requireChecks,
      checks,
      diagnosis: sections.map((s) => s.result.diagnosis).join(' '),
      overall: { passing, total: checks.length, severity },
      sections: Object.fromEntries(sections.map((s) => [s.label, s.result])),
    });
  } else {
    process.stdout.write(
      `${bold('USCE')} ${dim('·')} ${cyan(card.id)} ${dim('· ' + card.name)}\n`,
    );
    for (const section of sections) {
      if (sections.length > 1) process.stdout.write(`${dim(section.label)}\n`);
      for (const check of section.result.checks) {
        process.stdout.write(`${checkMark(check.severity)}  ${check.detail}\n`);
      }
    }
    const line = `${passing} of ${checks.length} checks passed · severity ${severity}`;
    process.stdout.write(`${dim('—')} ${severityColor(severity, line)}\n`);
    // The engine's own diagnoses, verbatim. They already explain a zero-check
    // run better than this layer could, and they are the strings the parity
    // fixture holds both runtimes to — paraphrasing here would make the two
    // CLIs describe the same verdict differently.
    for (const section of sections) {
      process.stdout.write(`${dim(section.result.diagnosis)}\n`);
    }
    if (checks.length === 0 && !opts.requireChecks) {
      process.stdout.write(
        `${dim('hint:')} ${cyan('--require-checks')} ${dim('makes a zero-check run a failure.')}\n`,
      );
    }
  }

  return severity === 'HIGH' ? 1 : 0;
}
