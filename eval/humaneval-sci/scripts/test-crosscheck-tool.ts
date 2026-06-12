// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Sanity check for lemma_hypothesis_crosscheck. Exercises three paths:
 *   1. By-id lookup of an existing HypothesisCard in the corpus.
 *   2. Inline well-formed HypothesisCard JSON.
 *   3. Inline malformed card — should return a structured error, not crash.
 *
 * If all three paths return sensible verdicts / errors, the bridge is
 * wired and the agent will be able to invoke it during the A/B treatment
 * loop without runtime surprises.
 */
import { runLemmaTool, LEMMA_TOOLS } from '../runner/lemma-tools.js';

console.log('Exposed tools:', LEMMA_TOOLS.map((t) => t.name).join(', '));
console.log('');

// Case 1: by-id lookup (existing HypothesisCard in the corpus)
console.log('=== By-id: free-fall-with-linear-drag ===');
const byId = await runLemmaTool('lemma_hypothesis_crosscheck', {
  id: 'free-fall-with-linear-drag',
});
console.log(summarise(byId));
console.log('');

// Case 2: inline card — well-formed
console.log('=== Inline card: well-formed ===');
const inlineGood = await runLemmaTool('lemma_hypothesis_crosscheck', {
  card: {
    kind: 'hypothesis',
    id: 'candidate-stefan-boltzmann',
    name: 'Candidate Stefan-Boltzmann equilibrium temperature',
    proposal: 'T = ((1-α)S / (4σ))^{1/4} from radiative balance',
    proposedFormulaTeX:
      'T_{eq} = \\left(\\frac{(1-\\alpha) S}{4\\sigma}\\right)^{1/4}',
    derivedFrom: {
      cardId: 'stefan-boltzmann-radiation',
      relationship: 'extends',
    },
    checks: {
      dimensional: {
        lhsLabel: 'T  [K]',
        lhsDims: { Theta: 1 },
        rhsLabel: '((1-α) S / (4σ))^(1/4)  [K]',
        rhsDims: { Theta: 1 },
      },
      referenceCorpus: { mustAgreeWith: ['stefan-boltzmann-radiation'] },
    },
    references: [],
    origin: 'hypothesis',
  },
});
console.log(summarise(inlineGood));
console.log('');

// Case 3: inline card — bad kind discriminator (must surface an error)
console.log('=== Inline card: bad kind (expect error) ===');
const inlineBad = await runLemmaTool('lemma_hypothesis_crosscheck', {
  card: { kind: 'principle', id: 'wrong' },
});
console.log(JSON.stringify(inlineBad, null, 2));

function summarise(out: unknown): string {
  const o = out as {
    overall?: { passing: number; total: number; severity: string };
    checks?: Array<{ name: string; severity: string }>;
    error?: string;
  };
  if (o.error) return `ERROR: ${o.error}`;
  const overall = o.overall;
  const checks = o.checks ?? [];
  const lines = [
    `overall: ${overall?.passing}/${overall?.total} severity=${overall?.severity}`,
  ];
  for (const c of checks) lines.push(`  ${c.severity.padEnd(5)} ${c.name}`);
  return lines.join('\n');
}
