// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Shared Markdown rendering for tool verdicts.
 *
 * Extracted when the tool count went from six to nine: three more tools each
 * formatting a verdict the same way is three more places for the wording to
 * drift, and the drift would be invisible because each tool is tested against
 * its own output. Same reasoning as `cards/format.ts` one layer down.
 *
 * Check `detail` strings are printed verbatim — they are what the parity
 * fixture holds both engines to, so paraphrasing them here would make the two
 * runtimes describe one verdict differently at the surface a user reads.
 */

import type { EvaluateResult, PrincipleCard } from '../cards/types.js';

export function renderVerdict(
  heading: string,
  card: PrincipleCard,
  result: EvaluateResult,
): string {
  const lines: string[] = [
    `# ${heading} — ${card.name}`,
    `Card: \`${card.id}\` v${card.version}`,
    ``,
    `**Overall:** ${result.overall.passing} / ${result.overall.total} pass · severity ${result.overall.severity}`,
    ``,
  ];
  for (const check of result.checks) {
    lines.push(`- [${check.severity === 'pass' ? 'OK' : 'X'}] **${check.name}** — ${check.detail}`);
  }
  lines.push(``, result.diagnosis);
  return lines.join('\n');
}
