/**
 * Cards loader — reads the canonical card corpus from
 * `repo/lemma/cards/**\/*.json` at module-init time. Self-contained in the
 * MCP server's own tree so the server ships without an external
 * package dependency.
 *
 * On-disk and in-memory both use `kind: "principle"` as the structural
 * discriminator (per lemma/schema/card.v0.1.json).
 */
import fs from 'node:fs';
import path from 'node:path';

import type { HypothesisCard, OpsCard, PrincipleCard } from './types.js';

function findCardsDir(): string {
  if (process.env.LEMMA_CARDS_DIR) {
    return path.resolve(process.env.LEMMA_CARDS_DIR);
  }
  const candidates = [
    path.resolve(process.cwd(), '..', 'cards'),
    path.resolve(process.cwd(), 'cards'),
    path.resolve(process.cwd(), '..', '..', 'lemma', 'cards'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Cannot locate cards directory. Tried: ${candidates.join(', ')}. ` +
      `Set LEMMA_CARDS_DIR explicitly to override.`,
  );
}

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

const CARDS_DIR = findCardsDir();
const ALL_CARD_FILES = walk(CARDS_DIR);

function isPrincipleRecord(card: unknown): boolean {
  return (
    typeof card === 'object' &&
    card !== null &&
    'kind' in card &&
    (card as { kind: unknown }).kind === 'principle'
  );
}

function isHypothesisRecord(card: unknown): boolean {
  return (
    typeof card === 'object' &&
    card !== null &&
    'kind' in card &&
    (card as { kind: unknown }).kind === 'hypothesis'
  );
}

function isOpsRecord(card: unknown): boolean {
  return (
    typeof card === 'object' &&
    card !== null &&
    'kind' in card &&
    (card as { kind: unknown }).kind === 'ops'
  );
}

function loadAll(): {
  principles: PrincipleCard[];
  hypotheses: HypothesisCard[];
  ops: OpsCard[];
} {
  const principles: PrincipleCard[] = [];
  const hypotheses: HypothesisCard[] = [];
  const ops: OpsCard[] = [];
  for (const filePath of ALL_CARD_FILES) {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (isPrincipleRecord(json)) {
      principles.push(json as PrincipleCard);
    } else if (isHypothesisRecord(json)) {
      hypotheses.push(json as HypothesisCard);
    } else if (isOpsRecord(json)) {
      ops.push(json as OpsCard);
    }
  }
  return { principles, hypotheses, ops };
}

const { principles, hypotheses, ops } = loadAll();

export const ALL_CARDS: PrincipleCard[] = principles;
export const HYPOTHESIS_CARDS: HypothesisCard[] = hypotheses;
export const OPS_CARDS: OpsCard[] = ops;

export function findPrincipleCard(id: string): PrincipleCard | undefined {
  return ALL_CARDS.find((c) => c.id === id);
}

export function findHypothesisCard(id: string): HypothesisCard | undefined {
  return HYPOTHESIS_CARDS.find((c) => c.id === id);
}

export function findOpsCard(id: string): OpsCard | undefined {
  return OPS_CARDS.find((c) => c.id === id);
}
