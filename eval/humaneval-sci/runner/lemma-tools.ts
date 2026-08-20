// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Lemma tool bridge — adapts the open verification engine to a generic
 * "function declaration" shape that any tool-use-capable LLM (Gemini,
 * Anthropic, OpenAI, ...) can call.
 *
 * Treatment-mode adapters expose these as callable tools. The control
 * arm sees none of them — that is the experimental contrast.
 *
 * Tools exposed:
 *   - lemma_cards_list           — discover available cards by id + kind
 *   - lemma_cards_get            — fetch full card JSON (formula, dims,
 *                                  validation envelopes, limit claims)
 *   - lemma_hypothesis_crosscheck — run the Lemma cross-check engine on
 *                                  a HypothesisCard (real dimensional
 *                                  analysis, reference resolution,
 *                                  limit / conservation claim recording)
 *
 * RAG retrieval is intentionally deferred — the seed corpus is small
 * enough that lemma_cards_list returns everything in one call.
 */
import {
  runHypothesisChecks,
  ALL_CARDS,
  HYPOTHESIS_CARDS,
  findHypothesisCard,
} from '@artano-ai/mcp-server/engine';
import type { HypothesisCard } from '@artano-ai/mcp-server/engine';

/** Generic tool declaration — the schema is JSON-Schema-shaped, so it
 *  maps 1:1 onto Gemini's `FunctionDeclaration`, Anthropic's `Tool`,
 *  and OpenAI's `function` definitions. */
export interface LemmaTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  /** Executes the tool. Inputs come from the LLM's tool call; return
   *  value is serialised as JSON and fed back as the tool result. */
  run(input: Record<string, unknown>): Promise<unknown>;
}

/** List every card in the corpus with id + short summary. Lets the
 *  agent discover what's available before requesting a full card. */
const cardsList: LemmaTool = {
  name: 'lemma_cards_list',
  description:
    'List all available Lemma cards (physics principles, ops recipes, hypotheses). ' +
    'Each entry has an id, a one-line summary, and the kind. Call this first when ' +
    'you need to find a card relevant to the scientific task at hand. The corpus ' +
    'is small enough that the full listing fits in one tool call.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  async run() {
    const all: Array<{ id: string; kind: string; summary: string }> = [];
    for (const card of ALL_CARDS) {
      all.push({
        id: card.id,
        kind: card.kind,
        summary:
          ('summary' in card && typeof card.summary === 'string'
            ? card.summary
            : '') ||
          ('title' in card && typeof card.title === 'string' ? card.title : ''),
      });
    }
    for (const card of HYPOTHESIS_CARDS) {
      all.push({
        id: card.id,
        kind: card.kind,
        summary: card.name ?? card.proposal ?? '',
      });
    }
    return all;
  },
};

/** Fields returned by default on lemma_cards_get when the caller does
 *  not specify a `fields` filter. The default slice is the minimum
 *  needed to ground a code-generation candidate: formula, symbols
 *  with dimensions, declared limit behaviour, and the dimensional
 *  vector. Auxiliary fields (validation envelopes, references,
 *  provenance, free-text discussion) are excluded by default to
 *  reduce the distraction-on-K-prompts mechanism documented in the
 *  pilot paper §4.2. Callers that want the whole record can request
 *  `fields: ['*']`. */
// These MUST be real field names from schema/card.v0.1.json. Four earlier
// entries here — 'summary', 'symbols', 'dimensions', 'limits' — were names no
// card has ever carried, so the slice below silently dropped the card's
// principles, conventions, expectedLimits and validationEnvelopes and returned
// a bare formula with no conditions of validity. That is not a degraded card,
// it is a misleading one, and it invalidated three adversarial-tier A/B runs
// before anyone looked at the payload. assertFieldsExist() below now makes
// that failure loud. Do not add a name here without checking the schema.
const DEFAULT_CARD_FIELDS = [
  'id',
  'kind',
  'name',
  'domain',
  'principles',
  'formulaTeX',
  'conventions',
  'expectedLimits',
  'validationEnvelopes',
] as const;

/** Fail loudly if a requested field name exists on no card in the corpus.
 *  A name that matches nothing is always a mistake — either a typo or schema
 *  drift — and silently returning fewer fields makes it invisible at exactly
 *  the moment it matters most. */
function assertFieldsExist(fields: readonly string[]): void {
  const present = new Set<string>();
  for (const card of ALL_CARDS as unknown as Record<string, unknown>[]) {
    for (const k of Object.keys(card)) present.add(k);
  }
  const unknown = fields.filter((f) => f !== '*' && !present.has(f));
  if (unknown.length > 0) {
    throw new Error(
      `lemma_cards_get: field(s) [${unknown.join(', ')}] exist on no card in ` +
        `the corpus. This is schema drift, not an empty result. Known fields: ` +
        `${[...present].sort().join(', ')}.`,
    );
  }
}

function sliceCard(
  card: Record<string, unknown> | null,
  fields: string[] | undefined,
): Record<string, unknown> | null {
  if (card === null) return null;
  // `fields: ['*']` or any wildcard returns the entire record (v0.1
  // behaviour).
  if (fields && fields.length > 0 && fields.includes('*')) return card;
  const requested =
    fields && fields.length > 0 ? fields : (DEFAULT_CARD_FIELDS as readonly string[]);
  assertFieldsExist(requested);
  const allowed = new Set<string>(requested);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(card)) {
    if (allowed.has(key)) out[key] = card[key];
  }
  // Always return id + kind so the consumer can identify what came back.
  if ('id' in card)   out.id = card.id;
  if ('kind' in card) out.kind = card.kind;
  return out;
}

/** Fetch a slice of a Lemma card by id. Default slice is the formula,
 *  symbols+dimensions, and limit behaviour — what a code-gen candidate
 *  needs. Pass `fields: ['*']` to get the full record. */
const cardsGet: LemmaTool = {
  name: 'lemma_cards_get',
  description:
    'Fetch a Lemma card by id. By default returns a *slice*: id, kind, name, ' +
    'summary, formula (text + LaTeX), symbols with declared dimensions, ' +
    'dimensional vector, and declared limit behaviour. Optionally pass ' +
    '`fields` to request specific keys (e.g. ["formula", "symbols"]); ' +
    'pass ["*"] to retrieve the whole record (validation envelopes, ' +
    'references, provenance, etc.). Use the default slice for routine ' +
    'code generation — it carries the load-bearing physics without the ' +
    'noise. Returns null if the id is not in the corpus — do not invent ids.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Exact card id, e.g. "stefan-boltzmann-radiation", "free-fall-uniform-gravity". ' +
          'Discoverable via lemma_cards_list.',
      },
      fields: {
        type: 'array',
        description:
          'Optional list of card-record field names to return. Defaults to a ' +
          'curated slice (formula, symbols, dimensions, limits). Pass ["*"] for the ' +
          'full record.',
      },
    },
    required: ['id'],
  },
  async run(input) {
    const id = String(input.id ?? '').trim();
    if (!id) return null;
    const fields = Array.isArray(input.fields)
      ? (input.fields as unknown[]).filter((f): f is string => typeof f === 'string')
      : undefined;
    const card =
      (ALL_CARDS.find((c) => c.id === id) as Record<string, unknown> | undefined) ??
      (findHypothesisCard(id) as Record<string, unknown> | undefined) ??
      null;
    return sliceCard(card, fields);
  },
};

/** Run the Lemma cross-check engine on a HypothesisCard. The treatment
 *  arm calls this to verify its own implied physics before submitting
 *  a candidate. Two ways to invoke:
 *   - `id`: pick an existing HypothesisCard from the seed corpus
 *   - `card`: pass an inline HypothesisCard built from the candidate's
 *     own assumptions (dimensional structure, limit claims, which
 *     corpus card it derives from). */
const hypothesisCrosscheck: LemmaTool = {
  name: 'lemma_hypothesis_crosscheck',
  description:
    'Run the Lemma cross-check engine on a HypothesisCard. Returns a verdict ' +
    'with per-check severity (NONE / LOW / MEDIUM / HIGH) covering dimensional ' +
    'analysis, reference-corpus resolution, declared limits, and conservation ' +
    "laws. Use this AFTER drafting a solution and BEFORE committing to it — " +
    "if the verdict surfaces HIGH severity, revise. Build the HypothesisCard " +
    "from the principle you are implementing: include a `checks.dimensional` " +
    "block with lhs/rhs labels + dimension vectors, list any `limits` " +
    "(regime → expected reduction), and set `referenceCorpus.mustAgreeWith` " +
    'to the card id(s) you are extending. Schema: `kind: "hypothesis"`, ' +
    '`id`, `name`, `proposal`, optional `proposedFormulaTeX`, ' +
    '`derivedFrom: {cardId, relationship}`, `checks: {...}`, `references: []`, ' +
    "`origin: \"hypothesis\"`. " +
    'Provide EITHER `id` (look up an existing card) OR `card` (inline JSON). ' +
    "If you don't have enough information to construct the card, look up the " +
    'relevant card via lemma_cards_get first.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Id of an existing HypothesisCard in the seed corpus (e.g. "free-fall-with-linear-drag"). Mutually exclusive with `card`.',
      },
      card: {
        type: 'object',
        description:
          'Inline HypothesisCard JSON. Use this to validate a card freshly constructed from your candidate solution.',
      },
    },
    required: [],
  },
  async run(input) {
    let card: HypothesisCard | undefined;

    if (typeof input.id === 'string' && input.id.trim()) {
      const found = findHypothesisCard(input.id);
      if (!found) {
        return {
          error: `No HypothesisCard with id "${input.id}" in the corpus. Use lemma_cards_list to discover ids, or pass an inline \`card\` instead.`,
        };
      }
      card = found;
    } else if (typeof input.card === 'object' && input.card !== null) {
      const inlineCard = input.card as Partial<HypothesisCard>;
      if (inlineCard.kind !== 'hypothesis') {
        return {
          error: `\`card.kind\` must be "hypothesis", got ${JSON.stringify(inlineCard.kind)}.`,
        };
      }
      card = inlineCard as HypothesisCard;
    } else {
      return {
        error: 'Must provide either `id` (string) or `card` (object).',
      };
    }

    try {
      const verdict = runHypothesisChecks(card, { corpus: ALL_CARDS });
      return {
        overall: verdict.overall,
        checks: verdict.checks.map((c) => ({
          name: c.name,
          severity: c.severity,
          detail: c.detail,
        })),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Crosscheck engine raised: ${msg}` };
    }
  },
};

export const LEMMA_TOOLS: LemmaTool[] = [cardsList, cardsGet, hypothesisCrosscheck];

/** Look up a tool by name and run it. Adapter code calls this when
 *  the LLM returns a tool-call block. */
export async function runLemmaTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const tool = LEMMA_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return { error: `Unknown tool: ${name}` };
  }
  try {
    return await tool.run(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Tool ${name} failed: ${msg}` };
  }
}
