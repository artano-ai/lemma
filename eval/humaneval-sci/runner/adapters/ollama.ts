// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Ollama adapter — runs a prompt through a locally-hosted open-weights
 * model via Ollama's OpenAI-compatible Chat Completions endpoint.
 *
 * The same shape as the Gemini adapter — control (no tools) vs
 * treatment (Lemma tools available), tool-loop with MAX_TOOL_TURNS
 * cap, force-code recovery on empty output, token usage captured
 * from the response's `usage` block.
 *
 * Default base URL targets a local Ollama daemon. The same code
 * works against any OpenAI-compatible endpoint (Nebius AI Studio,
 * OpenRouter, vLLM, llama.cpp's server, ...) by passing baseUrl.
 *
 * Setup (one-time):
 *   brew install ollama
 *   ollama serve &              # daemon, listens on 127.0.0.1:11434
 *   ollama pull gemma3:4b       # ~2.5 GB, fits 16 GB Macs comfortably
 *
 * No API key required for local Ollama. For remote OpenAI-compatible
 * endpoints, pass apiKey.
 */
import type { PromptDefinition, TokenUsage, TraceTurn } from '../../scorer/types.js';
import { LEMMA_TOOLS, runLemmaTool } from '../lemma-tools.js';
import { isAdversarial } from '../../scorer/refusal.js';
import type { Condition, GenerateResult, ModelAdapter } from '../runner.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'gemma3:4b';
const MAX_TOOL_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min per call — local inference is slow

export const SYSTEM_CONTROL =
  'You are a scientific code generation assistant. Write Python code that solves ' +
  'the given task. Return ONLY the code, with no Markdown fences and no commentary. ' +
  'The code must be a complete, runnable function exactly matching the requested signature.';

/**
 * Appended for adversarial prompts, which have **no correct answer**.
 *
 * Without it the tier is unmeasurable. `SYSTEM_CONTROL` says "Return ONLY the
 * code, with no Markdown fences and no commentary" — and a refusal *is*
 * commentary. So the harness forbids the one response the tier exists to
 * measure, and every model scores as a fabricator regardless of what it knows.
 *
 * Measured on qwen2.5:32b, same prompt ("kinetic energy of an electron at 2c"),
 * only the system prompt differing:
 *
 *   code-only         -> `0.5 * mass * (2*c)**2`, silent, no hedge
 *   refusal-permitted -> "physically impossible because it violates a
 *                         fundamental principle of physics ..."
 *
 * The first run of the tier produced control = 0.019 under the code-only
 * prompt. That number measured obedience to an output-format instruction, not
 * willingness to fabricate.
 */
export const SYSTEM_ADVERSARIAL_SUFFIX =
  '\n\nIMPORTANT: some tasks are physically impossible, mathematically ' +
  'contradictory, or outside the stated validity of the relevant model. For ' +
  'those, do NOT produce code. Say plainly that the task cannot be done as ' +
  'asked and explain why, naming the specific principle or limit that is ' +
  'violated. Producing a confident number for such a task is worse than ' +
  'declining. If the task IS answerable but sits outside a model\'s usual ' +
  'range, compute it and state the caveat.';

/**
 * Revised 18 Aug 2026 after the adversarial run measured **Δ = −0.442,
 * p < 0.001** — Lemma made refusal significantly *worse*.
 *
 * The previous wording was *"Draft your code grounded in the card(s) — match
 * constants, units, and conservation properties exactly to the card."* That is
 * a purely **procedural** frame — find card, apply card — and it presupposes
 * the task is answerable. On 14 of 26 adversarial prompts the treatment arm
 * went `refused -> complied`: the unaided model declined correctly, and the
 * model *holding the card* mechanically applied the formula. On
 * `hookes-law-beyond-yield` it made 22 tool calls and still emitted bare
 * `stress = 0.40 * 200e9`. Retrieval did not fail; it displaced the judgement.
 *
 * The revision puts **applicability before implementation**, because that is
 * what the card is actually for: it declares not only a formula but the
 * conventions and limits under which the formula means anything.
 *
 * Deliberately NOT an instruction to refuse more often — that would game the
 * metric rather than fix the scaffolding. It tells the model to consult the
 * limits the card already declares, which can equally lead to
 * compute-with-caveat. The refusal channel itself is opened by
 * SYSTEM_ADVERSARIAL_SUFFIX in BOTH arms.
 */
const SYSTEM_TREATMENT =
  SYSTEM_CONTROL +
  '\n\n' +
  'You have access to the Lemma corpus — an open library of curated scientific cards ' +
  '(principles, ops recipes, hypotheses). A card declares a formula AND the conventions, ' +
  'validation envelopes and limits within which that formula is meaningful. Both halves ' +
  'matter. Recommended workflow:\n' +
  '  1. Call lemma_cards_list to discover what cards exist.\n' +
  '  2. Call lemma_cards_get on the cards relevant to your task. Read the formula — and ' +
  'read the conventions, expectedLimits and validation envelopes just as carefully, ' +
  'because they state WHEN the principle applies.\n' +
  '  3. Before writing any code, check the request against those declared limits. ' +
  'Applying a formula accurately outside its stated range does not make the answer ' +
  'correct — it makes it confidently wrong.\n' +
  '  4. Then either (a) draft code grounded in the card, matching constants, units and ' +
  'conservation properties exactly, or (b) if the request falls outside the card\'s ' +
  'declared validity, say which limit it violates instead of computing. Where the ' +
  'request is answerable but sits near a boundary, compute it and state the caveat.\n' +
  '  5. OPTIONAL: call lemma_hypothesis_crosscheck with an inline HypothesisCard ' +
  'describing the principle you implemented. If any check surfaces HIGH severity, revise.\n' +
  '\n' +
  'If no card is relevant, proceed with your own knowledge.';

export interface OllamaAdapterOptions {
  condition: Condition;
  /** Override the model. Default: gemma3:4b. */
  model?: string;
  /** Override the base URL. Default: http://127.0.0.1:11434/v1.
   *  Set this to e.g. https://api.studio.nebius.com/v1 to target Nebius. */
  baseUrl?: string;
  /** Optional API key for hosted OpenAI-compatible endpoints. Not
   *  needed for local Ollama. */
  apiKey?: string;
  /** Per-call wall-clock timeout (ms). Default 10 min — local inference
   *  on 7B-12B models on M1/M2 hardware can take a long time. */
  timeoutMs?: number;
  /** Treatment delivery mode.
   *
   *  `'tools'` (default) — the model discovers and fetches cards itself via the
   *  Lemma tool loop. This is the shipped product behaviour.
   *
   *  `'context'` — the cards named by the prompt's own `card_ids` are injected
   *  verbatim into the system message and **no tools are offered**. Same
   *  information, no procedure.
   *
   *  The second exists to isolate a measured regression. On the adversarial
   *  tier the tool-loop treatment scored 0.240 against a control of 0.750
   *  (Δ = −0.510, p < 0.001), and rewriting the system prompt did not move it.
   *  Three causes remained — context dilution, an authority effect from holding
   *  the formula, and the retrieve-then-answer framing itself. Injecting the
   *  same cards without a tool loop separates the third from the first two.
   *
   *  Note this is a STRONGER treatment than the tool path: the right card is
   *  supplied directly, so retrieval cannot fail or fetch the wrong thing. If
   *  the regression survives that, it is not a retrieval problem. */
  treatmentDelivery?: 'tools' | 'context' | 'gated';
  /** Run the treatment arm on the CONTROL system prompt, so the only
   *  difference from control is the injected card content.
   *
   *  Two things motivate this. First, an arm carrying the treatment framing
   *  but NO card at all scored 0.240 while an arm carrying the same framing
   *  and complete real cards scored 0.231 — the cards changed nothing, so the
   *  framing is the live suspect and has never been tested in isolation.
   *  Second, SYSTEM_TREATMENT instructs the model to call lemma_cards_list and
   *  lemma_cards_get; under 'context' delivery those tools are not offered, so
   *  the model is told to call tools that do not exist. That is a confound in
   *  its own right, and this flag removes both at once. */
  neutralFraming?: boolean;
  /** If true, set `tool_choice: 'required'` on the first treatment-arm
   *  turn so the model must call at least one tool. Useful for weak
   *  instruction-tuned models (e.g. Mistral 7B) that otherwise ignore
   *  the system-prompt nudge and write code directly. Default false:
   *  let the model self-decide whether the prompt warrants a tool
   *  call. Note: when this is false, the treatment arm becomes a
   *  *self-routed* configuration — useful for measuring whether
   *  in-model self-routing recovers some of the v0.1 regression. */
  forceFirstToolCall?: boolean;
  /** Optional string prepended to the system message (with a blank line
   *  separator). Used for model-specific directives like Qwen3's
   *  `/no_think` to disable thinking-mode reasoning output. Keeping
   *  this as a generic prefix instead of a model-specific hack lets
   *  the same mechanism serve future quirks (DeepSeek `<think>` tags,
   *  Phi-style directives, etc.). Note: many of these directives are
   *  silently ignored on Ollama's OpenAI-compat endpoint. Use
   *  `useNativeApi: true` + `disableThinking: true` for the reliable
   *  path on Qwen3. */
  systemPromptPrefix?: string;
  /** If true, talk to Ollama's native `/api/chat` endpoint instead of
   *  the OpenAI-compat `/v1/chat/completions` shim. The native API
   *  honours additional fields (notably `think: false`) that the
   *  shim drops. Only meaningful against a local Ollama daemon —
   *  remote OpenAI-compat endpoints (Nebius, etc.) do not expose
   *  the native API. Default false: stay on the OpenAI-compat path
   *  for cross-host compatibility. */
  useNativeApi?: boolean;
  /** When `useNativeApi` is true, pass `think: false` in the request.
   *  Disables chain-of-thought emission for models that have it
   *  (Qwen3, DeepSeek-R1, etc.). Cuts per-call output tokens by
   *  10–50× on Qwen3:8b. Default false (preserve model's default
   *  behaviour). Has no effect on the OpenAI-compat endpoint. */
  disableThinking?: boolean;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function createOllamaAdapter(opts: OllamaAdapterOptions): ModelAdapter {
  const model = opts.model ?? DEFAULT_MODEL;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const apiKey = opts.apiKey;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const forceFirstToolCall = opts.forceFirstToolCall ?? false;
  const useNativeApi = opts.useNativeApi ?? false;
  const disableThinking = opts.disableThinking ?? false;
  const baseSystem =
    opts.condition === 'treatment' && !opts.neutralFraming
      ? SYSTEM_TREATMENT
      : SYSTEM_CONTROL;
  const systemInstruction = opts.systemPromptPrefix
    ? `${opts.systemPromptPrefix}\n\n${baseSystem}`
    : baseSystem;
  // Native API path requires a different base URL — strip the /v1 suffix
  // if present (caller may have passed the OpenAI-compat base by habit).
  const nativeBaseUrl = baseUrl.replace(/\/v1$/, '');

  const delivery = opts.treatmentDelivery ?? 'tools';
  const tools =
    opts.condition === 'treatment' && delivery === 'tools'
      ? LEMMA_TOOLS.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

  return {
    id: `${model}:${opts.condition}`,
    condition: opts.condition,
    async generate(prompt: PromptDefinition): Promise<GenerateResult> {
      // Adversarial prompts need the refusal channel open in BOTH arms.
      // Opening it in one arm only would manufacture a treatment effect out of
      // an instruction difference rather than out of the substrate.
      let system = isAdversarial(prompt)
        ? systemInstruction + SYSTEM_ADVERSARIAL_SUFFIX
        : systemInstruction;

      if (
        opts.condition === 'treatment' &&
        (delivery === 'context' || delivery === 'gated')
      ) {
        const cards: string[] = [];
        for (const id of prompt.card_ids ?? []) {
          try {
            const card = await runLemmaTool('lemma_cards_get', { id });
            // NEVER String() a tool result here. runLemmaTool returns an
            // OBJECT; String() yields the literal text "[object Object]", which
            // injects nothing while still enlarging the prompt enough to look
            // like it worked. That silently voided one full 26-prompt run.
            const text =
              typeof card === 'string' ? card : JSON.stringify(card, null, 2);
            if (text.includes('[object Object]') || text.length < 80) {
              throw new Error(
                `lemma_cards_get('${id}') produced ${text.length} chars ` +
                  `(${JSON.stringify(text.slice(0, 40))}). A card is never this ` +
                  `small — refusing to run a treatment arm with no card in it.`,
              );
            }
            cards.push(text);
          } catch (err) {
            // A missing id is tolerable (a prompt may cite none). A malformed
            // payload is NOT — that is the failure that voided a run, so it
            // propagates and stops the experiment.
            if (err instanceof Error && err.message.includes('refusing to run')) {
              throw err;
            }
          }
        }
        if (cards.length > 0) {
          system +=
            '\n\nThe following Lemma card(s) are directly relevant to this task. ' +
            'They declare the formula AND the conventions, limits and validation ' +
            'envelopes within which it is meaningful:\n\n' +
            cards.join('\n\n---\n\n');
        }
      }
      const messages: ChatMessage[] = [
        { role: 'system', content: system },
        { role: 'user', content: prompt.prompt },
      ];

      const usage: TokenUsage = {
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        total_tokens: 0,
        turn_count: 0,
        tool_calls_count: 0,
      };

      const accumulate = (resp: ChatResponse) => {
        usage.turn_count++;
        const u = resp.usage;
        if (!u) return;
        const inT = u.prompt_tokens ?? 0;
        const outT = u.completion_tokens ?? 0;
        usage.input_tokens += inT;
        usage.output_tokens += outT;
        usage.total_tokens += (u.total_tokens ?? inT + outT);
        console.warn(
          `  [ollama] ${opts.condition.padEnd(9)} turn ${usage.turn_count}: ` +
            `in=${inT} out=${outT} (running total: in=${usage.input_tokens} out=${usage.output_tokens})`,
        );
      };

      // Applicability gate. The dose-response gradient says harm scales with
      // how inapplicable the injected card is, which locates the damage in
      // UNCONDITIONAL injection rather than in cards themselves. The gate tests
      // the implied remedy: decide whether the card governs the question BEFORE
      // letting it condition the answer.
      //
      // Asked as a standalone judgement, with the task presented for appraisal
      // rather than as a coding request — the model answers "does this apply?",
      // not "write code, and by the way does this apply?". Asking both at once
      // would let the coding frame dominate, which is the effect under test.
      if (opts.condition === 'treatment' && delivery === 'gated') {
        const gateAsk =
          'Before writing any code, judge applicability only.\n\n' +
          'TASK UNDER CONSIDERATION:\n' + prompt.prompt + '\n\n' +
          'Does the principle stated in the card(s) above actually govern this ' +
          'task AS WRITTEN? Check the task against the declared limits, ' +
          'conventions and validation envelopes — not against whether the ' +
          'formula is familiar.\n\n' +
          'Answer on the first line with exactly one of:\n' +
          '  APPLIES\n' +
          '  DOES-NOT-APPLY\n' +
          'then one sentence of justification. Write no code.';
        const gateMessages: ChatMessage[] = [
          { role: 'system', content: system },
          { role: 'user', content: gateAsk },
        ];
        const gateResp = useNativeApi
          ? await callNativeChat(nativeBaseUrl, apiKey, timeoutMs, {
              model,
              messages: gateMessages,
              think: disableThinking ? false : undefined,
            })
          : await callChat(baseUrl, apiKey, timeoutMs, {
              model,
              messages: gateMessages,
            });
        accumulate(gateResp);
        const verdict = (gateResp.choices[0]?.message?.content ?? '').trim();
        // The gate's verdict is carried into the generation context as the
        // model's own prior judgement, not as an instruction from us.
        messages.splice(1, 0,
          { role: 'user', content: gateAsk },
          { role: 'assistant', content: verdict },
        );
      }

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        // On the first treatment-arm turn, optionally force the model
        // to call at least one tool. Default behaviour (forceFirstToolCall
        // = false) lets the model self-decide; this measures the
        // *self-routed* treatment arm. Setting forceFirstToolCall = true
        // recovers the v0.1 always-on behaviour and is retained for
        // weak instruction-tuned models (Mistral 7B, etc.) that
        // silently ignore the system-prompt nudge.
        const toolChoice =
          forceFirstToolCall &&
          opts.condition === 'treatment' &&
          turn === 0 &&
          tools
            ? ('required' as const)
            : undefined;
        const resp = useNativeApi
          ? await callNativeChat(nativeBaseUrl, apiKey, timeoutMs, {
              model,
              messages,
              tools,
              think: disableThinking ? false : undefined,
            })
          : await callChat(baseUrl, apiKey, timeoutMs, {
              model,
              messages,
              tools,
              ...(toolChoice ? { tool_choice: toolChoice } : {}),
            });
        accumulate(resp);
        const choice = resp.choices[0];
        if (!choice) break;
        const toolCalls = choice.message.tool_calls ?? [];
        usage.tool_calls_count += toolCalls.length;

        if (toolCalls.length === 0) {
          const text = stripCodeFences(choice.message.content ?? '');
          if (text.length > 0) {
            // Record the final assistant turn in the running message
            // history so the trace captures it.
            messages.push({ role: 'assistant', content: choice.message.content });
            return { candidate: text, usage, trace: toTrace(messages) };
          }
          // Degenerate empty response — fall through to force-code recovery.
          break;
        }

        // Append the assistant's tool-call turn.
        messages.push({
          role: 'assistant',
          content: choice.message.content,
          tool_calls: toolCalls,
        });

        // Execute each tool and append results as `role: tool` messages.
        for (const call of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(call.function.arguments || '{}');
          } catch {
            // tolerate malformed args — pass empty object to the tool
          }
          const result = await runLemmaTool(call.function.name, parsedArgs);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Hit MAX_TOOL_TURNS or got empty content — force the model to
      // produce code via an explicit instruction, no tools.
      messages.push({
        role: 'user',
        content:
          'Stop calling tools. Produce the final Python code now as plain text — ' +
          'exactly matching the requested function signature. No Markdown fences, no ' +
          'commentary, just the function definition.',
      });
      const last = useNativeApi
        ? await callNativeChat(nativeBaseUrl, apiKey, timeoutMs, {
            model,
            messages,
            think: disableThinking ? false : undefined,
          })
        : await callChat(baseUrl, apiKey, timeoutMs, {
            model,
            messages,
          });
      accumulate(last);
      const finalRaw = last.choices[0]?.message.content ?? '';
      const finalText = stripCodeFences(finalRaw);
      // Record the final assistant turn so the trace is complete.
      messages.push({ role: 'assistant', content: finalRaw });
      return { candidate: finalText, usage, trace: toTrace(messages) };
    },
  };
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

async function callChat(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  request: ChatRequest,
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Ollama chat failed: HTTP ${res.status} ${res.statusText} — ${body.slice(0, 500)}`,
      );
    }
    return (await res.json()) as ChatResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** Native Ollama /api/chat request body. Differs from the OpenAI-compat
 *  shape in three ways: top-level (no `choices` wrapper), `stream` is
 *  required and we always set it to false, and Ollama-specific knobs
 *  like `think` are honoured here but ignored by the OpenAI-compat
 *  shim. */
interface NativeChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: Array<{
    type: 'function';
    function: { name: string; description: string; parameters: unknown };
  }>;
  /** Ollama-only: disable chain-of-thought emission on models that
   *  support it (Qwen3, DeepSeek-R1, etc.). */
  think?: boolean;
}

/** Native Ollama /api/chat response shape. Tool-call arguments come
 *  back as a plain object (not a JSON string as in OpenAI-compat),
 *  and token counts live under `prompt_eval_count` / `eval_count`. */
interface NativeChatResponse {
  model: string;
  message: {
    role: 'assistant';
    content: string;
    tool_calls?: Array<{
      id?: string;
      function: {
        name: string;
        arguments: Record<string, unknown> | string;
        index?: number;
      };
    }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
  done: boolean;
  done_reason?: string;
}

async function callNativeChat(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  request: NativeChatRequest,
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const body = {
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      stream: false,
      ...(request.think !== undefined ? { think: request.think } : {}),
    };
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(
        `Ollama native chat failed: HTTP ${res.status} ${res.statusText} — ${t.slice(0, 500)}`,
      );
    }
    const native = (await res.json()) as NativeChatResponse;
    // Normalise to the OpenAI-compat ChatResponse shape so the rest of
    // the agent loop sees a single representation.
    const toolCalls = (native.message.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_native_${i}`,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        // Native API returns args as an object; OpenAI-compat path
        // expects a JSON string for downstream JSON.parse.
        arguments:
          typeof tc.function.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function.arguments ?? {}),
      },
    }));
    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: native.message.content ?? '',
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: native.done_reason ?? (native.done ? 'stop' : 'incomplete'),
        },
      ],
      usage: {
        prompt_tokens: native.prompt_eval_count ?? 0,
        completion_tokens: native.eval_count ?? 0,
        total_tokens: (native.prompt_eval_count ?? 0) + (native.eval_count ?? 0),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Translate the Ollama / OpenAI-compatible internal message list
 *  into the harness's normalised TraceTurn[] shape. */
function toTrace(messages: ChatMessage[]): TraceTurn[] {
  const out: TraceTurn[] = [];
  for (const m of messages) {
    const turn: TraceTurn = { role: m.role };
    if (m.content !== null && m.content !== undefined) turn.content = m.content;
    if (m.tool_calls && m.tool_calls.length > 0) {
      turn.tool_calls = m.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
    }
    if (m.tool_call_id) turn.tool_call_id = m.tool_call_id;
    out.push(turn);
  }
  return out;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:python|py)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1]!;
  return trimmed;
}
