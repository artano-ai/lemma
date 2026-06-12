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
import type { Condition, GenerateResult, ModelAdapter } from '../runner.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434/v1';
const DEFAULT_MODEL = 'gemma3:4b';
const MAX_TOOL_TURNS = 8;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 min per call — local inference is slow

const SYSTEM_CONTROL =
  'You are a scientific code generation assistant. Write Python code that solves ' +
  'the given task. Return ONLY the code, with no Markdown fences and no commentary. ' +
  'The code must be a complete, runnable function exactly matching the requested signature.';

const SYSTEM_TREATMENT =
  SYSTEM_CONTROL +
  '\n\n' +
  'You have access to the Lemma corpus — an open library of curated scientific cards ' +
  '(principles, ops recipes, hypotheses) with declared formulas, dimensional envelopes, ' +
  'and validation bounds. Recommended workflow before submitting code:\n' +
  '  1. Call lemma_cards_list to discover what cards exist.\n' +
  '  2. Call lemma_cards_get on the cards relevant to your task — read the formula, ' +
  'dimensional structure, validation envelopes, and limit claims.\n' +
  '  3. Draft your code grounded in the card(s) — match constants, units, and ' +
  'conservation properties exactly to the card.\n' +
  '  4. OPTIONAL: call lemma_hypothesis_crosscheck with an inline HypothesisCard ' +
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
    opts.condition === 'treatment' ? SYSTEM_TREATMENT : SYSTEM_CONTROL;
  const systemInstruction = opts.systemPromptPrefix
    ? `${opts.systemPromptPrefix}\n\n${baseSystem}`
    : baseSystem;
  // Native API path requires a different base URL — strip the /v1 suffix
  // if present (caller may have passed the OpenAI-compat base by habit).
  const nativeBaseUrl = baseUrl.replace(/\/v1$/, '');

  const tools =
    opts.condition === 'treatment'
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
      const messages: ChatMessage[] = [
        { role: 'system', content: systemInstruction },
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
