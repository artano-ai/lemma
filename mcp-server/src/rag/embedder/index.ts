// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import type { TransformersConfig } from './transformers.js';
import type { GeminiConfig } from './gemini.js';

export type EmbedderProvider = 'transformers' | 'gemini';

export interface Embedder {
  readonly provider: EmbedderProvider;
  readonly dim: number;
  embedQuery(text: string): Promise<number[]>;
  embedDocument(text: string): Promise<number[]>;
}

export type EmbedderConfig =
  | ({ provider: 'transformers' } & TransformersConfig)
  | ({ provider: 'gemini' } & GeminiConfig);

export async function makeEmbedder(config: EmbedderConfig): Promise<Embedder> {
  switch (config.provider) {
    case 'transformers': {
      const { TransformersEmbedder } = await import('./transformers.js');
      return new TransformersEmbedder(config);
    }
    case 'gemini': {
      const { GeminiEmbedder } = await import('./gemini.js');
      return new GeminiEmbedder(config);
    }
  }
}

export function truncateAndNormalize(vec: number[], dim: number): number[] {
  const truncated = vec.length > dim ? vec.slice(0, dim) : vec;
  let sumSq = 0;
  for (const x of truncated) sumSq += x * x;
  const norm = Math.sqrt(sumSq) || 1;
  return truncated.map((x) => x / norm);
}
