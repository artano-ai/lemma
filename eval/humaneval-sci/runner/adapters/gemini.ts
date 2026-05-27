/**
 * Gemini adapter — runs a prompt through Google's Gemini API in either
 * control (no tools) or treatment (Lemma tools available) condition.
 *
 * The same underlying model is used in both conditions so that Lemma
 * is the only independent variable in the experiment. The free tier
 * for Gemini 2.5 Flash is generous enough for benchmark runs at
 * smoke-test scale.
 *
 * Required env var: GEMINI_API_KEY
 *   Obtain a free key from Google AI Studio. Add to .env.local at the
 *   humaneval-sci root; the smoke script auto-loads it.
 */
import { GoogleGenAI, Type, type Content, type FunctionDeclaration, type Tool } from '@google/genai';

import type { PromptDefinition, TokenUsage, TraceTurn } from '../../scorer/types.js';
import { LEMMA_TOOLS, runLemmaTool } from '../lemma-tools.js';
import type { Condition, GenerateResult, ModelAdapter } from '../runner.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const SYSTEM_CONTROL =
  'You are a scientific code generation assistant. Write Python code that solves ' +
  'the given task. Return ONLY the code, with no Markdown fences and no commentary. ' +
  'The code must be a complete, runnable function exactly matching the requested ' +
  'signature.';

const SYSTEM_TREATMENT =
  SYSTEM_CONTROL +
  '\n\n' +
  'You have access to the Lemma corpus — an open library of curated scientific ' +
  'cards (principles, ops recipes, hypotheses) with declared formulas, dimensional ' +
  'envelopes, and validation bounds. Recommended workflow before submitting code:' +
  '\n' +
  '  1. Call lemma_cards_list to discover what cards exist.\n' +
  '  2. Call lemma_cards_get on the cards relevant to your task — read the formula, ' +
  'dimensional structure, validation envelopes, and limit claims.\n' +
  '  3. Draft your code grounded in the card(s) — match constants, units, and ' +
  'conservation properties exactly to the card.\n' +
  '  4. OPTIONAL: call lemma_hypothesis_crosscheck with an inline HypothesisCard ' +
  'describing the principle you implemented. The engine returns a verdict; if any ' +
  'check surfaces HIGH severity, revise before committing to your code.\n' +
  '\n' +
  'If no card is relevant, proceed with your own knowledge.';

const MAX_TOOL_TURNS = 8;

/** Default retry policy. The free tier returns 429 RESOURCE_EXHAUSTED
 *  with a server-suggested retry hint (typically 30s for per-minute
 *  quotas). We retry transparently so a smoke run on the free tier
 *  "just works" — slowly — without surfacing the rate-limit error.
 *
 *  Total worst-case wait if all 4 retries fire: 30 + 45 + 60 + 90 = ~3.75 min
 *  per individual call before we bail. Adjust via `maxRetries` / `baseDelayMs`. */
const DEFAULT_MAX_RETRIES = 4;
const DEFAULT_BASE_DELAY_MS = 30_000;

export interface GeminiAdapterOptions {
  condition: Condition;
  /** Override the model. Default: gemini-2.5-flash (free tier: 5 RPM).
   *  Higher-throughput free options:
   *    - gemini-2.5-flash-lite  (15 RPM)
   *    - gemini-2.0-flash-lite  (30 RPM) */
  model?: string;
  /** Override the API key. Default: process.env.GEMINI_API_KEY. */
  apiKey?: string;
  /** Override the 429 retry budget. Default: 4 retries with 30s/45s/60s/90s waits. */
  maxRetries?: number;
}

export function createGeminiAdapter(opts: GeminiAdapterOptions): ModelAdapter {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY not set. Add it to humaneval-sci/.env.local or export it. ' +
        'Free keys: https://aistudio.google.com/apikey',
    );
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const ai = new GoogleGenAI({ apiKey });

  // Wraps generateContent with 429-aware backoff. Free-tier quotas
  // reset on a per-minute window; we sleep through one window per retry.
  async function callWithRetry(
    request: Parameters<typeof ai.models.generateContent>[0],
  ): Promise<Awaited<ReturnType<typeof ai.models.generateContent>>> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await ai.models.generateContent(request);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === maxRetries) throw err;
        const retryAfterMs = parseRetryDelayMs(err) ??
          DEFAULT_BASE_DELAY_MS * Math.pow(1.5, attempt);
        const status = (err as { status?: number }).status;
        const tag = status === 429 ? '429 rate-limit' : `${status} ${statusLabel(status)}`;
        console.warn(
          `  [gemini] ${tag} hit. Sleeping ${Math.round(retryAfterMs / 1000)}s (attempt ${attempt + 1}/${maxRetries}).`,
        );
        await sleep(retryAfterMs);
      }
    }
    throw lastErr;
  }

  const systemInstruction =
    opts.condition === 'treatment' ? SYSTEM_TREATMENT : SYSTEM_CONTROL;

  const tools: Tool[] | undefined =
    opts.condition === 'treatment'
      ? [{ functionDeclarations: LEMMA_TOOLS.map(toGeminiFunctionDeclaration) }]
      : undefined;

  return {
    id: `${model}:${opts.condition}`,
    condition: opts.condition,
    async generate(prompt: PromptDefinition): Promise<GenerateResult> {
      const history: Content[] = [
        { role: 'user', parts: [{ text: prompt.prompt }] },
      ];

      const usage: TokenUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        total_tokens: 0,
        turn_count: 0,
        tool_calls_count: 0,
      };

      const accumulateUsage = (
        response: Awaited<ReturnType<typeof ai.models.generateContent>>,
      ) => {
        usage.turn_count++;
        const meta = response.usageMetadata;
        if (!meta) return;
        const promptTokens = meta.promptTokenCount ?? 0;
        const candidateTokens = meta.candidatesTokenCount ?? 0;
        const cachedTokens = meta.cachedContentTokenCount ?? 0;
        usage.input_tokens += promptTokens;
        usage.output_tokens += candidateTokens;
        usage.cached_input_tokens += cachedTokens;
        usage.total_tokens += promptTokens + candidateTokens;
        console.warn(
          `  [gemini] ${opts.condition.padEnd(9)} turn ${usage.turn_count}: ` +
            `in=${promptTokens} out=${candidateTokens}` +
            (cachedTokens > 0 ? ` cached=${cachedTokens}` : '') +
            ` (running total: in=${usage.input_tokens} out=${usage.output_tokens})`,
        );
      };

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const response = await callWithRetry({
          model,
          contents: history,
          config: {
            systemInstruction,
            ...(tools ? { tools } : {}),
          },
        });
        accumulateUsage(response);

        const calls = response.functionCalls ?? [];
        usage.tool_calls_count += calls.length;

        if (calls.length === 0) {
          const text = stripCodeFences(response.text ?? '');
          if (text.length > 0) {
            // Record the final assistant turn in history so the trace
            // captures it.
            history.push({ role: 'model', parts: [{ text: response.text ?? '' }] });
            return {
              candidate: text,
              usage,
              trace: contentsToTrace(systemInstruction, history),
            };
          }
          // Model returned no tool calls AND no text — degenerate response,
          // fall through to the explicit code-production nudge below.
          break;
        }

        // Append the assistant's tool-call turn to history.
        const assistantParts = calls.map((call) => ({
          functionCall: { name: call.name ?? '', args: call.args ?? {} },
        }));
        history.push({ role: 'model', parts: assistantParts });

        // Execute every tool call and append responses as one user turn.
        const toolResultParts = [];
        for (const call of calls) {
          const result = await runLemmaTool(
            call.name ?? '',
            (call.args ?? {}) as Record<string, unknown>,
          );
          toolResultParts.push({
            functionResponse: {
              name: call.name ?? '',
              response: { result },
            },
          });
        }
        history.push({ role: 'user', parts: toolResultParts });
      }

      // Exited the tool loop without final code — either hit
      // MAX_TOOL_TURNS or the model returned empty text. Force it to
      // produce code with an explicit instruction and no tools.
      history.push({
        role: 'user',
        parts: [{
          text:
            'Stop calling tools. Produce the final Python code now as ' +
            'plain text — exactly matching the requested function signature. ' +
            'No Markdown fences, no commentary, just the function definition.',
        }],
      });
      const last = await callWithRetry({
        model,
        contents: history,
        config: { systemInstruction },
      });
      accumulateUsage(last);
      history.push({ role: 'model', parts: [{ text: last.text ?? '' }] });
      return {
        candidate: stripCodeFences(last.text ?? ''),
        usage,
        trace: contentsToTrace(systemInstruction, history),
      };
    },
  };
}

/** Translate Gemini's Content[] history into the harness's normalised
 *  TraceTurn[] shape. The system instruction is prepended as a
 *  separate turn so the trace is self-contained (Gemini passes the
 *  system prompt as a config field, not as a Content entry).
 *
 *  Uses loose `any`/`unknown` access on Part objects because the SDK's
 *  Part is a union of many variants (text, functionCall, functionResponse,
 *  inlineData, fileData, ...) — pattern-match by checking field presence
 *  rather than relying on the discriminated union. */
function contentsToTrace(systemInstruction: string, history: Content[]): TraceTurn[] {
  const out: TraceTurn[] = [];
  out.push({ role: 'system', content: systemInstruction });
  let toolCallCounter = 0;
  let pendingToolCallIds: string[] = [];
  for (const turn of history) {
    const role: TraceTurn['role'] = turn.role === 'model' ? 'assistant' : 'user';
    const parts = (turn.parts ?? []) as Array<Record<string, unknown>>;

    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter((t) => t.length > 0)
      .join('');

    const callParts = parts.filter(
      (p) => typeof p.functionCall === 'object' && p.functionCall !== null,
    );
    const responseParts = parts.filter(
      (p) => typeof p.functionResponse === 'object' && p.functionResponse !== null,
    );

    if (callParts.length > 0) {
      const tool_calls = callParts.map((cp) => {
        const fc = cp.functionCall as { name?: string; args?: unknown };
        const id = `gemini_call_${++toolCallCounter}`;
        pendingToolCallIds.push(id);
        return {
          id,
          name: fc.name ?? '',
          arguments: JSON.stringify(fc.args ?? {}),
        };
      });
      out.push({ role: 'assistant', ...(text ? { content: text } : {}), tool_calls });
      continue;
    }

    if (responseParts.length > 0) {
      for (let i = 0; i < responseParts.length; i++) {
        const fr = responseParts[i]!.functionResponse as { name?: string; response?: unknown };
        const id = pendingToolCallIds[i] ?? `gemini_call_unmatched_${i}`;
        out.push({
          role: 'tool',
          tool_call_id: id,
          content: JSON.stringify(fr.response ?? null),
        });
      }
      pendingToolCallIds = [];
      continue;
    }

    out.push({ role, content: text });
  }
  return out;
}

/** Map our generic LemmaTool to Gemini's typed FunctionDeclaration.
 *  The shapes are nearly identical; we just need to translate the
 *  string "type" tags into the SDK's Type enum. */
function toGeminiFunctionDeclaration(t: (typeof LEMMA_TOOLS)[number]): FunctionDeclaration {
  const properties: Record<string, { type: Type; description: string }> = {};
  for (const [key, value] of Object.entries(t.parameters.properties)) {
    properties[key] = {
      type: stringToGeminiType(value.type),
      description: value.description,
    };
  }
  return {
    name: t.name,
    description: t.description,
    parameters: {
      type: Type.OBJECT,
      properties,
      required: t.parameters.required,
    },
  };
}

function stringToGeminiType(s: string): Type {
  switch (s) {
    case 'string':
      return Type.STRING;
    case 'number':
      return Type.NUMBER;
    case 'integer':
      return Type.INTEGER;
    case 'boolean':
      return Type.BOOLEAN;
    case 'array':
      return Type.ARRAY;
    case 'object':
      return Type.OBJECT;
    default:
      return Type.STRING;
  }
}

/** Detect transient Google API errors that warrant a retry: 429
 *  RESOURCE_EXHAUSTED (rate limit) and any 5xx (model overloaded /
 *  unavailable / gateway). 4xx errors other than 429 are client
 *  bugs and not worth retrying. */
function isRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== 'number') return false;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function statusLabel(status: number | undefined): string {
  switch (status) {
    case 500: return 'INTERNAL';
    case 502: return 'BAD_GATEWAY';
    case 503: return 'UNAVAILABLE';
    case 504: return 'GATEWAY_TIMEOUT';
    default: return 'transient';
  }
}

/** Try to extract the server-suggested retry delay (milliseconds) from
 *  a 429 ApiError. The SDK serialises the full JSON body into the
 *  error message; we regex out the `retryDelay: "32s"` hint. Returns
 *  null if not parseable, in which case the caller falls back to an
 *  exponential default. */
function parseRetryDelayMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return null;
  const match = message.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (!match) return null;
  const seconds = parseInt(match[1], 10);
  if (Number.isNaN(seconds)) return null;
  // Add a 2s safety margin — the server's hint is the minimum.
  return (seconds + 2) * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Defensive — even with explicit "no fences" instruction, models
 *  sometimes wrap code in ```python ... ```. Strip the wrapper so
 *  the functional scorer sees raw code. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:python|py)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1];
  return trimmed;
}
