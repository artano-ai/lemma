// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma crosscheck` — run the hypothesis cross-check engine over a proposed
 * card, either one already in the corpus or a JSON file being drafted.
 *
 * Drafting is the interesting case: it lets an author check a card *before*
 * opening a pull request, which is where the schema-valid-but-physically-wrong
 * class of mistake is cheapest to catch.
 *
 * Exit codes match `verify`: 0 clean, 1 the engine found a HIGH severity,
 * 2 the command could not run.
 *
 * ## Why a `warn` does not fail the build
 *
 * A warn means the engine *declined to answer* — the claim is recorded but not
 * discharged. Treating that as a failure would punish authors for stating
 * claims the engine cannot yet check, which is exactly backwards: the corpus
 * wants those claims written down. Only a `fail` (HIGH) exits non-zero.
 */

import { readFileSync } from 'node:fs';
import { ALL_CARDS, findHypothesisCard, runHypothesisChecks } from '@artano-ai/mcp-server/engine';
import type { HypothesisCard } from '@artano-ai/mcp-server/engine';
import { bold, checkMark, cyan, dim, emitJson, severityColor, type Severity } from '../render.js';
import { CliError } from '../errors.js';

export interface CrosscheckOptions {
  target: string;
  json: boolean;
}

function loadCard(target: string): HypothesisCard {
  const fromCorpus = findHypothesisCard(target);
  if (fromCorpus) return fromCorpus;

  // Not a corpus id — treat it as a path to a draft.
  let raw: string;
  try {
    raw = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
  } catch {
    throw new CliError(
      `"${target}" is neither a hypothesis card id in the corpus nor a readable file. ` +
        `Run \`lemma cards list --kind hypothesis\` to see the corpus ids.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError(`${target} is not valid JSON: ${(err as Error).message}`);
  }
  const card = parsed as Partial<HypothesisCard>;
  if (card?.kind !== 'hypothesis') {
    throw new CliError(
      `${target} has kind "${String(card?.kind)}"; cross-check only applies to kind "hypothesis".`,
    );
  }
  return card as HypothesisCard;
}

export function crosscheck(opts: CrosscheckOptions): number {
  const card = loadCard(opts.target);
  // The corpus is what `mustAgreeWith` / `derivedFrom` resolve against, so a
  // draft is always checked against the full live corpus — not against itself.
  const result = runHypothesisChecks(card, { corpus: ALL_CARDS });
  const severity = result.overall.severity as Severity;

  if (opts.json) {
    emitJson({ card: card.id, ...result });
  } else {
    process.stdout.write(
      `${bold('Cross-check')} ${dim('·')} ${cyan(card.id)} ${dim('· ' + card.name)}\n`,
    );
    for (const check of result.checks) {
      process.stdout.write(`${checkMark(check.severity)}  ${check.detail}\n`);
    }
    const line = `${result.overall.passing} of ${result.overall.total} checks passed · severity ${severity}`;
    process.stdout.write(`${dim('—')} ${severityColor(severity, line)}\n`);
    // Engine prose, verbatim — see the note in verify.ts.
    process.stdout.write(`${dim(result.diagnosis)}\n`);
  }

  return severity === 'HIGH' ? 1 : 0;
}
