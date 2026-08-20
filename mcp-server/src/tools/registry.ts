// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * The registered tool set.
 *
 * Lives here rather than in `index.ts` so it can be asserted without starting
 * the server — `index.ts` calls `main()` on import, so anything importing it
 * to inspect the registry would open a stdio transport instead.
 *
 * The set is worth pinning because **the count is load-bearing outside this
 * package**: the platform paper's supplement tabulates the tools of the v0.1.0
 * release, and both READMEs and the docs site enumerate them. Adding a tool
 * without updating those leaves a published document describing a surface that
 * no longer matches. A failing test is a cheaper reminder than a reviewer.
 *
 * Note the paper's statements are scoped to **v0.1.0** and stay true of that
 * archived artifact regardless of what is registered here — exactly as its
 * "38 cards" stays true while the live corpus holds more. Growth is fine;
 * silent growth is not.
 */

import { agreementCheckTool } from './agreement-check.js';
import { cardsGetTool } from './cards-get.js';
import { cardsListTool } from './cards-list.js';
import { convergenceCheckTool } from './convergence-check.js';
import { hypothesisCrosscheckTool } from './hypothesis-crosscheck.js';
import { opsGetTool } from './ops-get.js';
import { ragLookupTool } from './rag-lookup.js';
import { seriesCheckTool } from './series-check.js';
import { usceCheckTool } from './usce-check.js';
import type { McpTool } from './types.js';

export const TOOLS: McpTool[] = [
  // Corpus access.
  cardsListTool,
  cardsGetTool,
  opsGetTool,
  // Verification. `hypothesis_crosscheck` gates a *proposed* card; the rest
  // check a *finished* run, each against a different shape of evidence.
  hypothesisCrosscheckTool,
  usceCheckTool,
  seriesCheckTool,
  convergenceCheckTool,
  agreementCheckTool,
  // Retrieval. The only tool needing external infrastructure.
  ragLookupTool,
];

export const REGISTRY = new Map(TOOLS.map((t) => [t.name, t]));
