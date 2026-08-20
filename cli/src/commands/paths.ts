// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma paths` — say where the corpus actually resolved from.
 *
 * Small command, disproportionately useful. The loader tries a bundled copy
 * first and then several relative locations, so "which cards am I actually
 * checking against" is a real question with a non-obvious answer — especially
 * inside a repo that has both a working tree and a bundled `_corpus`. Guessing
 * wrong there means verifying against a stale snapshot and believing the
 * result.
 */

import { ALL_CARDS, CARDS_DIR, HYPOTHESIS_CARDS, OPS_CARDS } from '@artano-ai/mcp-server/engine';
import { bold, cyan, dim, emitJson } from '../render.js';

export function paths(json: boolean): number {
  const override = process.env.LEMMA_CARDS_DIR ?? null;
  const counts = {
    principle: ALL_CARDS.length,
    ops: OPS_CARDS.length,
    hypothesis: HYPOTHESIS_CARDS.length,
  };
  const total = counts.principle + counts.ops + counts.hypothesis;

  if (json) {
    emitJson({ cardsDir: CARDS_DIR, cardsDirOverride: override, counts, total });
    return 0;
  }

  process.stdout.write(`${bold('Lemma corpus')}\n`);
  // The resolved path, reported by the loader itself. An earlier version
  // inferred it from whether LEMMA_CARDS_DIR was set and printed "using the
  // bundled corpus" — which was wrong whenever the loader had fallen through
  // to a repo checkout. The one command whose job is to say where the cards
  // came from must not guess.
  process.stdout.write(`  ${dim('cards')}            ${cyan(CARDS_DIR)}\n`);
  process.stdout.write(
    `  ${dim('source')}           ${
      override ? dim('LEMMA_CARDS_DIR') : dim('resolved by the loader (LEMMA_CARDS_DIR unset)')
    }\n`,
  );
  process.stdout.write(
    `  ${dim('loaded')}           ${total} cards ` +
      `${dim(`(${counts.principle} principle · ${counts.ops} ops · ${counts.hypothesis} hypothesis)`)}\n`,
  );
  return 0;
}
