// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { ALL_CARDS, findPrincipleCard } from '../cards/seed.js';
import { runAgreementChecks } from '../cards/agreement.js';
import { renderVerdict } from './render.js';
import type { McpTool } from './types.js';

export const agreementCheckTool: McpTool = {
  name: 'agreement_check',
  description:
    "Check whether independent methods agree on the same observables, within the tolerances a principle card declares in `crossMethodTolerances`. Pass `id` (a principle card id) and `outputs` (a map of method name to that method's observables). This sits one relation above usce_check: an envelope bounds a single run's value, this bounds the DISAGREEMENT between runs. Its default is deliberately the opposite of the envelope check's — fewer than two methods is an error rather than a pass, because a single method cannot corroborate itself, and two methods sharing no observable returns HIGH rather than quietly reporting that nothing disagreed.",
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Principle card id whose crossMethodTolerances to apply, e.g. "cross-method-reproducibility".',
      },
      outputs: {
        type: 'object',
        additionalProperties: { type: 'object', additionalProperties: { type: 'number' } },
        description:
          'Map of method name to its observables, e.g. { "method-a": { "latticeConstant_A": 5.470 }, "method-b": { "latticeConstant_A": 5.475 } }.',
      },
    },
    required: ['id', 'outputs'],
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
    const outputs = (input.outputs ?? {}) as Record<string, Record<string, number>>;
    return renderVerdict('Agreement verdict', card, runAgreementChecks(outputs, card));
  },
};
