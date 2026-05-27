/**
 * Anthropic adapter for HumanEval-Sci runner. Stub — wire a real call
 * to the Anthropic API once we're ready to publish baseline numbers.
 */
import type { PromptDefinition } from '../../scorer/types.js';
import type { Condition, GenerateResult, ModelAdapter } from '../runner.js';

export interface AnthropicAdapterOptions {
  apiKey: string;
  model: string;
  condition: Condition;
  maxTokens?: number;
}

export function createAnthropicAdapter(
  opts: AnthropicAdapterOptions,
): ModelAdapter {
  return {
    id: `anthropic:${opts.model}:${opts.condition}`,
    condition: opts.condition,
    async generate(_prompt: PromptDefinition): Promise<GenerateResult> {
      // TODO: real API call. Use @anthropic-ai/sdk; system prompt should
      // be terse: "Generate the requested function. Return only code, no
      // prose, no markdown fences." Strip leading/trailing fences if the
      // model includes them.
      throw new Error(
        `Anthropic adapter not yet wired. Implement the API call to ${opts.model}.`,
      );
    },
  };
}
