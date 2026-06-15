// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Public engine API for `@artano-ai/mcp-server` — the cards corpus and the
 * verification engines, without the MCP server itself. Reference clients (e.g.
 * the HumanEval-Sci harness) import this instead of reaching into `src/`:
 *
 *   import { runHypothesisChecks, ALL_CARDS } from '@artano-ai/mcp-server/engine';
 */

export { runHypothesisChecks } from './cards/checks.js';
export { runUsceChecks } from './cards/usce.js';
export {
  deriveDims,
  dimsEqual,
  stringifyDims,
  DimDerivationError,
} from './cards/dimensional.js';
export {
  ALL_CARDS,
  OPS_CARDS,
  HYPOTHESIS_CARDS,
  findPrincipleCard,
  findOpsCard,
  findHypothesisCard,
} from './cards/seed.js';
export type {
  PrincipleCard,
  OpsCard,
  HypothesisCard,
  DimVec,
  DimensionalCheckSpec,
  ConservationLawSpec,
  LimitCheckSpec,
  EvaluateResult,
  UsceCheck,
  CheckSeverity,
} from './cards/types.js';
