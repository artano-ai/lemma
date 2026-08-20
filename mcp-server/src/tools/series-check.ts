// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { ALL_CARDS, findPrincipleCard } from '../cards/seed.js';
import { runSeriesChecks } from '../cards/series.js';
import { renderVerdict } from './render.js';
import type { McpTool } from './types.js';

export const seriesCheckTool: McpTool = {
  name: 'series_check',
  description:
    'Check a reported series against the sign and bound conditions a principle card declares in `seriesConditions`. Pass `id` (a principle card id) and `series` (a map of quantity name to its samples — the columns of one table, all the same length). Distinct from usce_check, which bounds a magnitude: these bound a SIGN or relation, which can be universal where a magnitude is not. That is why cards deliberately carrying no validationEnvelopes can still be checked here — a density of states has no system-independent range but cannot be negative in any material, at any k-mesh, under any smearing. A condition covering no reported sample is reported as vacuous rather than passing.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Principle card id whose seriesConditions to check against, e.g. "density-of-states".',
      },
      series: {
        type: 'object',
        additionalProperties: { type: 'array', items: { type: 'number' } },
        description:
          'Map of quantity name to its samples, e.g. { "epsilon": [-1, 0, 1], "g": [0.0, 1.2, 0.4] }. Every column must have the same length.',
      },
    },
    required: ['id', 'series'],
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
    const series = (input.series ?? {}) as Record<string, number[]>;
    for (const [key, value] of Object.entries(series)) {
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'number')) {
        throw new Error(`Series "${key}" must be an array of numbers.`);
      }
    }
    return renderVerdict('Series verdict', card, runSeriesChecks(series, card));
  },
};
