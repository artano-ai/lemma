#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Corpus integrity checks that JSON Schema structurally cannot perform.
 *
 * `ajv` validates one file at a time. That is the right tool for "is this card
 * well-formed" and the wrong tool for every question that spans files — and the
 * interesting failures are all cross-file:
 *
 *   1. Two cards claiming the same `id`.
 *   2. A card whose `domain` disagrees with the folder it lives in.
 *   3. A reference — `mustAgreeWith`, `mayContradict`, `derivedFrom`,
 *      `limits[].target.cardId` — pointing at a card that does not exist.
 *   4. The TypeScript types drifting from the schema they are a projection of.
 *
 * All four passed `ajv` cleanly when this script was written, verified by
 * feeding it a duplicate id and a dangling reference: both reported `valid`.
 * The corpus happened to be clean, but nothing was keeping it that way.
 *
 * Check 4 exists because `mcp-server/src/cards/types.ts` says of itself that it
 * is "a hand-typed projection" of the schema. Six fields had already drifted out
 * of it — every machine form on `limits[]`, plus `formula` and `evolution` —
 * added to the schema and the Python models but never to TypeScript. Nothing
 * caught it because TypeScript types are erased at runtime, so the engines kept
 * agreeing byte-for-byte while the type definitions diverged.
 *
 * Zero dependencies: this runs in the `cards` CI job, which installs nothing.
 *
 *   node scripts/check-corpus.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS = path.join(ROOT, 'cards');

const problems = [];
const fail = (msg) => problems.push(msg);

// --- load ------------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.json')) out.push(full);
  }
  return out;
}

const files = walk(CARDS).sort();
const cards = files.map((file) => {
  try {
    return { file, card: JSON.parse(readFileSync(file, 'utf8')) };
  } catch (err) {
    fail(`${path.relative(ROOT, file)}: not valid JSON — ${err.message}`);
    return null;
  }
}).filter(Boolean);

// --- 1. duplicate ids ------------------------------------------------------

const byId = new Map();
for (const { file, card } of cards) {
  const seen = byId.get(card.id);
  if (seen) {
    fail(
      `duplicate card id "${card.id}" in ${path.relative(ROOT, seen)} and ` +
        `${path.relative(ROOT, file)}. Ids are the corpus's primary key: a duplicate ` +
        `makes every reference to it ambiguous, and which one wins depends on directory order.`,
    );
  } else {
    byId.set(card.id, file);
  }
}

// --- 2. domain agrees with the folder path ---------------------------------

for (const { file, card } of cards) {
  const parts = path.relative(CARDS, file).split(path.sep);
  // `cards/ops/` and `cards/hypotheses/` are flat and carry no domain.
  if (parts.length !== 3) continue;
  const expected = `${parts[0]}-${parts[1]}`;
  if (card.domain !== expected) {
    fail(
      `${card.id}: declares domain "${card.domain}" but lives in ${parts[0]}/${parts[1]}/ ` +
        `(expected "${expected}"). The folder path and the domain field are two spellings of ` +
        `the same fact; when they disagree, tools that group by one disagree with tools that ` +
        `group by the other.`,
    );
  }
}

// --- 3. every cross-reference resolves -------------------------------------

const known = new Set(byId.keys());
const refs = ({ card }) => {
  const out = [];
  const rc = card.checks?.referenceCorpus ?? {};
  for (const key of ['mustAgreeWith', 'mayContradict']) {
    for (const id of rc[key] ?? []) out.push([`checks.referenceCorpus.${key}`, id]);
  }
  if (card.derivedFrom?.cardId) out.push(['derivedFrom.cardId', card.derivedFrom.cardId]);
  for (const limit of card.checks?.limits ?? []) {
    if (limit.target?.cardId) out.push([`limits[${limit.name}].target.cardId`, limit.target.cardId]);
  }
  return out;
};

for (const entry of cards) {
  for (const [where, id] of refs(entry)) {
    if (!known.has(id)) {
      fail(
        `${entry.card.id}: ${where} points at "${id}", which is not in the corpus. ` +
          `The engine resolves this at runtime and reports it as a failed check — so a ` +
          `dangling reference turns into a verdict about the science rather than a broken link.`,
      );
    }
  }
}

// --- 4. the TypeScript projection has not drifted from the schema ----------

const schema = JSON.parse(readFileSync(path.join(ROOT, 'schema', 'card.v0.1.json'), 'utf8'));
const tsSource = readFileSync(
  path.join(ROOT, 'mcp-server', 'src', 'cards', 'types.ts'),
  'utf8',
);

/** Field names declared on a TypeScript interface. */
function tsFields(name) {
  const match = tsSource.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) return null;
  return new Set([...match[1].matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]));
}

// Only the shapes the schema actually keeps in `$defs`. The check specs are
// defined inline under HypothesisChecksSpec and are compared separately below.
const PROJECTIONS = [
  ['PrincipleCard', 'PrincipleCard'],
  ['OpsCard', 'OpsCard'],
  ['HypothesisCard', 'HypothesisCard'],
  ['HypothesisChecksSpec', 'HypothesisChecksSpec'],
  ['MachineFormula', 'MachineFormula'],
];

for (const [defName, ifaceName] of PROJECTIONS) {
  const schemaFields = new Set(Object.keys(schema.$defs?.[defName]?.properties ?? {}));
  const declared = tsFields(ifaceName);
  if (!declared) {
    fail(`types.ts declares no interface ${ifaceName}, but the schema defines ${defName}.`);
    continue;
  }
  for (const field of schemaFields) {
    if (!declared.has(field)) {
      fail(
        `types.ts ${ifaceName} is missing "${field}", which the schema defines on ${defName}. ` +
          `TypeScript types are erased at runtime, so the engines keep agreeing while the ` +
          `type definitions diverge — this will not show up as a failing verdict.`,
      );
    }
  }
  for (const field of declared) {
    if (!schemaFields.has(field)) {
      fail(`types.ts ${ifaceName} declares "${field}", which the schema does not define on ${defName}.`);
    }
  }
}

// Check specs the schema keeps inline under HypothesisChecksSpec rather than in
// $defs. Compared one-way only — the schema is the authority for what a card may
// contain, and these interfaces legitimately carry no extra fields today, but a
// two-way check here would fire on any TS-side convenience field.
const checksProps = schema.$defs?.HypothesisChecksSpec?.properties ?? {};
const nested = [
  ['checks.dimensional', checksProps.dimensional?.properties, 'DimensionalCheckSpec'],
  ['checks.limits[]', checksProps.limits?.items?.properties, 'LimitCheckSpec'],
  ['checks.conservationLaws[]', checksProps.conservationLaws?.items?.properties, 'ConservationLawSpec'],
  ['checks.referenceCorpus', checksProps.referenceCorpus?.properties, 'ReferenceCorpusCheckSpec'],
];
for (const [label, props, ifaceName] of nested) {
  const declared = tsFields(ifaceName);
  if (!props) {
    fail(`the schema defines no properties for ${label}; this check needs updating.`);
    continue;
  }
  if (!declared) {
    fail(`types.ts declares no interface ${ifaceName}, but the schema defines ${label}.`);
    continue;
  }
  for (const field of Object.keys(props)) {
    if (!declared.has(field)) {
      fail(
        `types.ts ${ifaceName} is missing "${field}", which the schema defines on ${label}. ` +
          `TypeScript types are erased at runtime, so this will not show up as a failing verdict.`,
      );
    }
  }
}

// --- report ----------------------------------------------------------------

const counts = cards.reduce((acc, { card }) => {
  acc[card.kind] = (acc[card.kind] ?? 0) + 1;
  return acc;
}, {});

if (problems.length === 0) {
  const summary = Object.entries(counts)
    .sort()
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
  console.log(`corpus integrity: OK — ${cards.length} cards (${summary})`);
  process.exit(0);
}

console.error(`corpus integrity: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
for (const problem of problems) console.error(`  • ${problem}\n`);
process.exit(1);
