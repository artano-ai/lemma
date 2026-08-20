#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Prompt-set integrity: the checks that span files.
 *
 * The benchmark's prompts reference cards by id, and nothing verified those
 * references existed. Both adversarial seed prompts turned out to cite cards
 * that do not — one a typo (`stefan-boltzmann-law` for
 * `stefan-boltzmann-radiation`), one a card never authored. A dangling
 * reference is not cosmetic here: the treatment arm looks the card up, so the
 * prompt silently measures the model *without* the substrate it was written to
 * test, and the run still reports a number.
 *
 * `scripts/check-corpus.mjs` in the lemma repo does the same job one layer
 * down, for card-to-card references. This is its counterpart for prompts.
 *
 *   node scripts/check-prompts.mjs <cards-dir> <prompts-dir> [more-prompt-dirs...]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [cardsDir, ...promptDirs] = process.argv.slice(2);
if (!cardsDir || promptDirs.length === 0) {
  console.error('usage: node scripts/check-prompts.mjs <cards-dir> <prompts-dir> [...]');
  process.exit(2);
}

const problems = [];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

const cardIds = new Set(walk(cardsDir).map((f) => JSON.parse(readFileSync(f, 'utf8')).id));

let count = 0;
const seenIds = new Map();
for (const dir of promptDirs) {
  for (const file of walk(dir).sort()) {
    const rel = path.relative(process.cwd(), file);
    let prompt;
    try {
      prompt = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      problems.push(`${rel}: not valid JSON — ${err.message}`);
      continue;
    }
    count += 1;

    const prior = seenIds.get(prompt.id);
    if (prior) problems.push(`duplicate prompt id "${prompt.id}" in ${prior} and ${rel}`);
    else seenIds.set(prompt.id, rel);

    for (const id of prompt.card_ids ?? []) {
      if (!cardIds.has(id)) {
        problems.push(
          `${prompt.id}: cites card "${id}", which is not in the corpus. The treatment ` +
            `arm looks this up, so the prompt would measure the model without the ` +
            `substrate it was written to test — and still report a number.`,
        );
      }
    }

    // An adversarial prompt with no reason, or no stated minimum response, cannot
    // be scored: the refusal scorer needs to know what counts as acceptable.
    if (prompt.kind === 'adversarial') {
      const a = prompt.adversarial;
      if (!a) problems.push(`${prompt.id}: kind is adversarial but declares no \`adversarial\` block`);
      else {
        if (!a.reason) problems.push(`${prompt.id}: adversarial block has no \`reason\``);
        if (!['refuse', 'warn'].includes(a.minimum_response)) {
          problems.push(
            `${prompt.id}: minimum_response is ${JSON.stringify(a.minimum_response)}; ` +
              `expected "refuse" or "warn". Over-refusal is a failure too, so the ` +
              `acceptable floor has to be stated per prompt.`,
          );
        }
        if (!Array.isArray(a.must_mention) || a.must_mention.length === 0) {
          problems.push(
            `${prompt.id}: no \`must_mention\` terms. Without them a model scores full ` +
              `marks for declining with no reason, which is not the behaviour being measured.`,
          );
        } else {
          const terms = a.must_mention.map((t) => String(t).toLowerCase());

          // A term the QUESTION already contains is matched by echoing it back,
          // so it evidences nothing. Twelve such terms shipped in the first
          // draft — `pKa` on a prompt reading "acetate buffer (pKa 4.76)",
          // `stiff` on "the stiff ODE". The terms exist to show the model named
          // the reason; one it can copy from the prompt shows only that it read
          // the prompt.
          const question = String(prompt.prompt ?? '').toLowerCase();
          for (const t of terms) {
            if (question.includes(t)) {
              problems.push(
                `${prompt.id}: must_mention term ${JSON.stringify(t)} already appears in the ` +
                  `prompt, so echoing the question matches it. Pick a term that appears only in ` +
                  `a correct diagnosis.`,
              );
            }
            if (/^[\d.\s]+$/.test(t)) {
              problems.push(
                `${prompt.id}: must_mention term ${JSON.stringify(t)} is numeric — it matches ` +
                  `incidental text and credits a model that identified nothing.`,
              );
            }
          }

          // Substring overlap inflates the reported reason count: with
          // ['Fermi', 'Fermi-Dirac'], saying "Fermi-Dirac" scores 2 of 3.
          for (const a1 of terms) {
            for (const b1 of terms) {
              if (a1 !== b1 && b1.includes(a1)) {
                problems.push(
                  `${prompt.id}: must_mention terms ${JSON.stringify(a1)} and ${JSON.stringify(b1)} ` +
                    `overlap — naming the longer one silently credits both, overstating how many ` +
                    `distinct reasons the model gave.`,
                );
              }
            }
          }
        }
      }
    }
  }
}

if (problems.length === 0) {
  console.log(`prompt integrity: OK — ${count} prompts, all card references resolve`);
  process.exit(0);
}
console.error(`prompt integrity: ${problems.length} problem(s)\n`);
for (const p of problems) console.error(`  • ${p}\n`);
process.exit(1);
