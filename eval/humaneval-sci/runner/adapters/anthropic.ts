/**
 * Anthropic adapter for the HumanEval-Sci runner — runs a prompt through
 * Anthropic's Messages API in either control (no tools) or treatment
 * (Lemma tools available) condition. The same model is used in both arms
 * so that Lemma is the only independent variable, mirroring the Gemini
 * adapter.
 *
 * EXPERIMENTAL: the call path is real (Messages API + a manual tool loop),
 * but it has not yet been validated against the committed landmark
 * baselines — there is no Anthropic run in the record pool. Treat any
 * numbers it produces as provisional until a baseline run is committed and
 * cross-checked. It deliberately uses only the long-stable Messages
 * surface (no extended-thinking / structured-output parameters) so it
 * typechecks and runs across SDK versions; "return only code" is enforced
 * via the system prompt.
 *
 * Required env var: ANTHROPIC_API_KEY
 *   Get a key at https://console.anthropic.com/settings/keys. Add it to
 *   .env.local at the humaneval-sci root; the smoke scripts auto-load it.
 *
 * The system prompts below mirror runner/adapters/gemini.ts verbatim so
 * the control/treatment contrast is identical across providers.
 */
import Anthropic from '@anthropic-ai/sdk';

import type { PromptDefinition, TokenUsage, TraceTurn } from '../../scorer/types.js';
import { LEMMA_TOOLS, runLemmaTool } from '../lemma-tools.js';
import type { Condition, GenerateResult, ModelAdapter } from '../runner.js';

/** Project-locked default backbone model (the v0 application wraps
 *  third-party APIs with Claude Sonnet 4.6 as the default). */
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOOL_TURNS = 8;

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
  'check surfaces HIGH severity, revise before committing to your code.' +
  '\n' +
  'If no card is relevant, proceed with your own knowledge.';

export interface AnthropicAdapterOptions {
  condition: Condition;
  /** Override the model. Default: claude-sonnet-4-6. */
  model?: string;
  /** Override the API key. Default: process.env.ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Override max output tokens per call. Default: 4096. */
  maxTokens?: number;
}

export function createAnthropicAdapter(
  opts: AnthropicAdapterOptions,
): ModelAdapter {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set. Add it to humaneval-sci/.env.local or export it. ' +
        'Get a key at https://console.anthropic.com/settings/keys',
    );
  }
  const model = opts.model ?? DEFAULT_MODEL;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const client = new Anthropic({ apiKey });

  console.warn(
    `  [anthropic] EXPERIMENTAL adapter (${model}:${opts.condition}) — real API ` +
      'wiring, not yet validated against committed baselines.',
  );

  const system =
    opts.condition === 'treatment' ? SYSTEM_TREATMENT : SYSTEM_CONTROL;

  // The generic LemmaTool schema is already JSON-Schema-shaped, so it maps
  // straight onto Anthropic's `input_schema`.
  const tools: Anthropic.Tool[] | undefined =
    opts.condition === 'treatment'
      ? LEMMA_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Tool.InputSchema,
        }))
      : undefined;

  return {
    id: `${model}:${opts.condition}`,
    condition: opts.condition,
    async generate(prompt: PromptDefinition): Promise<GenerateResult> {
      const messages: Anthropic.MessageParam[] = [
        { role: 'user', content: prompt.prompt },
      ];
      const trace: TraceTurn[] = [
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

      const accumulate = (resp: Anthropic.Message) => {
        usage.turn_count++;
        const inT = resp.usage?.input_tokens ?? 0;
        const outT = resp.usage?.output_tokens ?? 0;
        const cached = resp.usage?.cache_read_input_tokens ?? 0;
        usage.input_tokens += inT;
        usage.output_tokens += outT;
        usage.cached_input_tokens += cached;
        usage.total_tokens += inT + outT;
      };

      const textOf = (resp: Anthropic.Message): string =>
        resp.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const resp = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          ...(tools ? { tools } : {}),
        });
        accumulate(resp);

        const toolUses = resp.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );
        const text = textOf(resp);

        if (toolUses.length === 0) {
          if (text.length > 0) {
            trace.push({ role: 'assistant', content: text });
            return { candidate: stripCodeFences(text), usage, trace };
          }
          // Empty, no tool calls — degenerate; fall through to the
          // explicit code-production nudge below.
          break;
        }

        usage.tool_calls_count += toolUses.length;

        trace.push({
          role: 'assistant',
          ...(text ? { content: text } : {}),
          tool_calls: toolUses.map((tu) => ({
            id: tu.id,
            name: tu.name,
            arguments: JSON.stringify(tu.input ?? {}),
          })),
        });
        // Echo the assistant turn (incl. tool_use blocks) back for the loop.
        messages.push({ role: 'assistant', content: resp.content });

        // Execute every tool call; one tool_result per tool_use, or the
        // API rejects the follow-up.
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          const result = await runLemmaTool(
            tu.name,
            (tu.input ?? {}) as Record<string, unknown>,
          );
          const serialized = JSON.stringify(result);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: serialized,
          });
          trace.push({
            role: 'tool',
            tool_call_id: tu.id,
            content: serialized,
          });
        }
        messages.push({ role: 'user', content: toolResults });
      }

      // Exited the tool loop without final code — hit MAX_TOOL_TURNS or an
      // empty response. Force plain code with no tools available.
      messages.push({
        role: 'user',
        content:
          'Stop calling tools. Produce the final Python code now as plain ' +
          'text — exactly matching the requested function signature. No ' +
          'Markdown fences, no commentary, just the function definition.',
      });
      const last = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        messages,
      });
      accumulate(last);
      const finalText = textOf(last);
      trace.push({ role: 'assistant', content: finalText });
      return { candidate: stripCodeFences(finalText), usage, trace };
    },
  };
}

/** Defensive — even with an explicit "no fences" instruction, models
 *  sometimes wrap code in ```python ... ```. Strip the wrapper so the
 *  functional scorer sees raw code. */
function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:python|py)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) return fenced[1];
  return trimmed;
}
