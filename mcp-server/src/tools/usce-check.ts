// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { ALL_CARDS, findPrincipleCard } from '../cards/seed.js';
import { runUsceChecks } from '../cards/usce.js';
import type { McpTool } from './types.js';

export const usceCheckTool: McpTool = {
  name: 'usce_check',
  description:
    'Run the Universal Sanity Check Engine (USCE) on a finished numeric output: range-check the values against a principle card\'s validationEnvelopes. Pass `id` (a principle card id, e.g. "ideal-gas-law") and `output` (a map of envelope key to number, e.g. {"gasConstant_J_per_molK": 8.3145}). Returns per-key verdicts (within -> pass, outside -> HIGH) and an overall severity. v1 checks validation envelopes; causality and asymptotic-decay checks over time-series outputs are future work.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Principle card id whose validationEnvelopes to check against, e.g. "ideal-gas-law".',
      },
      output: {
        type: 'object',
        additionalProperties: { type: 'number' },
        description:
          'Map of envelope key to the finished output value, e.g. { "gasConstant_J_per_molK": 8.3145 }.',
      },
    },
    required: ['id', 'output'],
  },
  async run(input) {
    const id = String(input.id ?? '').trim();
    if (!id) {
      throw new Error('Empty id.');
    }
    const card = findPrincipleCard(id);
    if (!card) {
      const known = ALL_CARDS.map((c) => c.id).join(', ');
      throw new Error(
        `No principle card with id "${id}" in the seed corpus. Known ids: ${known}.`,
      );
    }
    const output = (input.output ?? {}) as Record<string, number>;
    const result = runUsceChecks(output, card);

    const lines: string[] = [
      `# USCE verdict -- ${card.name}`,
      `Card: \`${card.id}\` v${card.version}`,
      ``,
      `**Overall:** ${result.overall.passing} / ${result.overall.total} pass - severity ${result.overall.severity}`,
      ``,
    ];
    for (const c of result.checks) {
      lines.push(`- [${c.severity === 'pass' ? 'OK' : 'X'}] **${c.name}** -- ${c.detail}`);
    }
    lines.push(``, result.diagnosis);
    return lines.join('\n');
  },
};
