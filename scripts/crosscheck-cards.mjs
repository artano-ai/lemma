#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Run the cross-check engine over the cards a change touches, and report a
 * verdict per card.
 *
 * `ajv` answers "is this card well-formed". `check-corpus.mjs` answers "is the
 * corpus internally consistent". Neither answers **"is this card right"** — and
 * that is the class of defect this project exists to catch. A card in this
 * corpus once claimed a quantity was a Lyapunov function proving asymptotic
 * stability when its rate was not sign-definite: schema-valid, fluent,
 * correctly formatted, and false. Both of the other checks passed it.
 *
 * Usage:
 *   node scripts/crosscheck-cards.mjs                 # every card
 *   node scripts/crosscheck-cards.mjs <file> [...]    # specific cards
 *   BASE_REF=origin/main node scripts/crosscheck-cards.mjs --changed
 *
 * ## Why `warn` does not fail the build
 *
 * The engine returns `warn` when it **declines** to check — a declared limit
 * with no machine form, say. Treating that as a rejection would teach
 * contributors that declaring a claim is punished, so the honest move becomes
 * declaring nothing — pushing the corpus away from being checkable at all.
 * "Could not check" and "checked, and wrong" are different events and must not
 * share a penalty.
 *
 * Only `fail` — checked, and wrong — blocks.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const CARDS = join(ROOT, 'cards');

/** The engine ships as a built package; CI builds it before running this. */
const ENGINE = join(ROOT, 'mcp-server', 'dist', 'engine.js');
let engine;
try {
  engine = await import(pathToFileURL(ENGINE).href);
} catch {
  console.error(`crosscheck: engine not built at ${relative(ROOT, ENGINE)}`);
  console.error('Run `pnpm --filter @artano-ai/mcp-server build` first.');
  process.exit(2);
}
const { runHypothesisChecks, ALL_CARDS } = engine;

function allCardFiles(dir = CARDS, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allCardFiles(p, out);
    else if (entry.endsWith('.json')) out.push(p);
  }
  return out;
}

function changedCardFiles() {
  const base = process.env.BASE_REF || 'origin/main';
  const out = execSync(`git diff --name-only --diff-filter=d ${base}...HEAD -- cards/`, {
    cwd: ROOT,
    encoding: 'utf-8',
  });
  return out.split('\n').filter((l) => l.endsWith('.json')).map((l) => join(ROOT, l));
}

const args = process.argv.slice(2);
const files = args.includes('--changed')
  ? changedCardFiles()
  : args.length
    ? args.map((a) => (a.startsWith('/') ? a : join(process.cwd(), a)))
    : allCardFiles();

if (files.length === 0) {
  console.log('crosscheck: no cards to check.');
  process.exit(0);
}

let failed = 0;
let declined = 0;

console.log(`crosscheck: ${files.length} card(s)\n`);

for (const file of files) {
  const rel = relative(ROOT, file);
  let card;
  try {
    card = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    console.log(`  FAIL  ${rel}\n        unreadable: ${err.message}`);
    failed++;
    continue;
  }

  // Only hypothesis cards carry a `checks` block the engine can evaluate.
  // Principle and ops cards are covered by ajv + check-corpus; saying so
  // explicitly beats silently reporting them as passing something they were
  // never subjected to.
  if (card.kind !== 'hypothesis') {
    console.log(`  skip  ${rel}  (${card.kind}: no declared checks to evaluate)`);
    continue;
  }

  const verdict = runHypothesisChecks(card, { corpus: ALL_CARDS });
  const bad = verdict.checks.filter((c) => c.severity === 'fail');
  const warned = verdict.checks.filter((c) => c.severity === 'warn');

  if (bad.length) {
    failed++;
    console.log(`  FAIL  ${rel}`);
    for (const c of bad) console.log(`        ${c.name}: ${c.detail}`);
  } else {
    console.log(`  ok    ${rel}  (${verdict.overall.passing}/${verdict.overall.total} checks pass)`);
  }
  if (warned.length) {
    declined += warned.length;
    for (const c of warned) console.log(`        not checked — ${c.name}: ${c.detail}`);
  }
}

console.log(
  `\ncrosscheck: ${failed} failing, ${declined} claim(s) recorded but not checked.`,
);
if (declined && !failed) {
  // Reported, never fatal: an undischarged claim is a gap in coverage, not a
  // defect, and failing on it would push authors toward declaring nothing.
  console.log('Undischarged claims do not fail the build — they are coverage, not defects.');
}
process.exit(failed ? 1 : 0);
