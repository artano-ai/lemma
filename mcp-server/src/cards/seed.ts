// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Re-export façade. The corpus is read from
 * `repo/lemma/cards/**\/*.json` via `loader.ts`.
 *
 * Tool modules that imported from `cards/seed.js` keep working —
 * the public API (`ALL_CARDS`, `HYPOTHESIS_CARDS`,
 * `findPrincipleCard`, `findHypothesisCard`) is preserved.
 */
export {
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  OPS_CARDS,
  findHypothesisCard,
  findOpsCard,
  findPrincipleCard,
} from './loader.js';
