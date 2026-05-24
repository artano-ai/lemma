/**
 * Re-export façade. The corpus is read from
 * `repo/lemma/cards/**\/*.json` via `loader.ts`.
 *
 * Tool modules that imported from `cards/seed.js` keep working —
 * the public API (`ALL_CARDS`, `PHYSICS_CARDS`, `HYPOTHESIS_CARDS`,
 * `findPhysicsCard`, `findHypothesisCard`) is preserved.
 */
export {
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  OPS_CARDS,
  PHYSICS_CARDS,
  findHypothesisCard,
  findOpsCard,
  findPhysicsCard,
} from './loader.js';
