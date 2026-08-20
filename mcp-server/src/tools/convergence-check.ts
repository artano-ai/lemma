// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { ALL_CARDS, findPrincipleCard } from '../cards/seed.js';
import { runConvergenceCheck, type ConvergencePoint } from '../cards/convergence.js';
import { renderVerdict } from './render.js';
import type { McpTool } from './types.js';

export const convergenceCheckTool: McpTool = {
  name: 'convergence_check',
  description:
    "Recompute an observed order of accuracy from a refinement study and check it against the order a principle card declares. Pass `id` (a principle card id, e.g. \"runge-kutta-4\") and `refinement` (an array of [h, error] pairs). This differs from reporting the order to usce_check: that range-checks a number you supply, whereas this measures the order from the study itself. A sequence that is not a clean power law — typically because small-h levels are round-off-limited — returns a warning with the per-level orders attached rather than a failure, because a contaminated measurement is not a wrong method.",
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Principle card id declaring the expected order, e.g. "runge-kutta-4".',
      },
      refinement: {
        type: 'array',
        items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        description:
          'Refinement levels as [h, error] pairs, e.g. [[0.1, 1e-5], [0.05, 2.5e-6], [0.025, 6.25e-7]].',
      },
    },
    required: ['id', 'refinement'],
  },
  async run(input) {
    const id = String(input.id ?? '').trim();
    if (!id) throw new Error('Empty id.');
    const card = findPrincipleCard(id);
    if (!card) {
      throw new Error(
        `No principle card with id "${id}" in the corpus. Known ids: ${ALL_CARDS.map((c) => c.id).join(', ')}.`,
      );
    }
    const raw = input.refinement;
    if (
      !Array.isArray(raw) ||
      raw.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number'))
    ) {
      throw new Error(
        'refinement must be an array of [h, error] pairs, e.g. [[0.1, 1e-3], [0.05, 2.5e-4]].',
      );
    }
    return renderVerdict('Convergence verdict', card, runConvergenceCheck(raw as ConvergencePoint[], card));
  },
};
