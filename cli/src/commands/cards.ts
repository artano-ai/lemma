// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma cards` — browse the corpus. `list`, `show`, `search`.
 *
 * `list` and `show` are also reachable as bare `lemma list` / `lemma show`,
 * matching the Python CLI. That aliasing is deliberate: both packages install a
 * binary called `lemma`, so on a machine with both, whichever wins the PATH
 * should still answer to the same commands. A user should not have to know
 * which runtime they got.
 *
 * ## `search` is substring matching, and says so
 *
 * It scans ids, names, domains and the `principles` list. It is not semantic
 * search — `rag_lookup` on the MCP server is, and it needs a vector index.
 * Overselling this as semantic would send someone to debug an empty result set
 * that is behaving exactly as built.
 */

import {
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  OPS_CARDS,
  type HypothesisCard,
  type OpsCard,
  type PrincipleCard,
} from '@artano-ai/mcp-server/engine';
import { bold, cyan, dim, emitJson, green, magenta, table, yellow } from '../render.js';
import { CliError } from '../errors.js';

type AnyCard = PrincipleCard | OpsCard | HypothesisCard;

function everyCard(): AnyCard[] {
  return [...ALL_CARDS, ...OPS_CARDS, ...HYPOTHESIS_CARDS];
}

function kindColor(kind: string, text: string): string {
  if (kind === 'principle') return green(text);
  if (kind === 'ops') return cyan(text);
  if (kind === 'hypothesis') return yellow(text);
  return text;
}

function domainOf(card: AnyCard): string {
  return (card as PrincipleCard).domain ?? '—';
}

export interface ListOptions {
  domain?: string;
  kind?: string;
  json: boolean;
}

export function list(opts: ListOptions): number {
  let cards = everyCard();
  if (opts.kind) {
    const kind = opts.kind.toLowerCase();
    if (!['principle', 'ops', 'hypothesis'].includes(kind)) {
      throw new CliError(`Unknown kind "${opts.kind}". Expected principle, ops, or hypothesis.`);
    }
    cards = cards.filter((c) => c.kind === kind);
  }
  if (opts.domain) {
    const needle = opts.domain.toLowerCase();
    cards = cards.filter((c) => domainOf(c).toLowerCase().startsWith(needle));
  }
  cards.sort((a, b) => a.id.localeCompare(b.id));

  if (opts.json) {
    emitJson(cards.map((c) => ({ id: c.id, kind: c.kind, name: c.name, domain: domainOf(c) })));
    return 0;
  }

  if (cards.length === 0) {
    process.stdout.write(dim('No cards match that filter.\n'));
    return 0;
  }

  process.stdout.write(
    table(
      cards.map((c) => [cyan(c.id), kindColor(c.kind, c.kind), c.name, dim(domainOf(c))]),
      ['id', 'kind', 'name', 'domain'],
    ) + '\n',
  );
  process.stdout.write(dim(`\n${cards.length} card${cards.length === 1 ? '' : 's'}\n`));
  return 0;
}

export function show(cardId: string, json: boolean): number {
  const card = everyCard().find((c) => c.id === cardId);
  if (!card) {
    throw new CliError(
      `Unknown card id: "${cardId}". Run \`lemma cards list\` to see every card.`,
    );
  }
  if (json) {
    emitJson(card);
    return 0;
  }
  process.stdout.write(
    `${bold(cyan(card.id))} ${dim('·')} ${card.name} ${dim('·')} ${kindColor(card.kind, card.kind)}\n\n`,
  );
  process.stdout.write(JSON.stringify(card, null, 2) + '\n');
  return 0;
}

export function search(query: string, json: boolean): number {
  const needle = query.trim().toLowerCase();
  if (!needle) throw new CliError('Search query is empty.');

  const hits = everyCard().filter((card) => {
    const haystack = [
      card.id,
      card.name,
      domainOf(card),
      ...((card as PrincipleCard).principles ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
  hits.sort((a, b) => a.id.localeCompare(b.id));

  if (json) {
    emitJson(hits.map((c) => ({ id: c.id, kind: c.kind, name: c.name, domain: domainOf(c) })));
    return 0;
  }

  if (hits.length === 0) {
    process.stdout.write(
      dim(`No card matches "${query}". This is substring matching over ids, names, domains\n`) +
        dim('and principles — not semantic search.\n'),
    );
    return 0;
  }

  process.stdout.write(
    table(
      hits.map((c) => [cyan(c.id), kindColor(c.kind, c.kind), c.name, dim(domainOf(c))]),
      ['id', 'kind', 'name', 'domain'],
    ) + '\n',
  );
  process.stdout.write(
    dim(`\n${hits.length} match${hits.length === 1 ? '' : 'es'} for ${magenta(query)}\n`),
  );
  return 0;
}
