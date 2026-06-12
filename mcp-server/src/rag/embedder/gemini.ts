// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import { GoogleGenAI } from '@google/genai';
import type { Embedder, EmbedderProvider } from './index.js';

export interface GeminiConfig {
  apiKey: string;
  model: string;
  dim: number;
}

export class GeminiEmbedder implements Embedder {
  readonly provider: EmbedderProvider = 'gemini';
  readonly dim: number;
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(config: GeminiConfig) {
    if (!config.apiKey) {
      throw new Error('GeminiEmbedder requires an API key.');
    }
    this.client = new GoogleGenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.dim = config.dim;
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embed(text, 'RETRIEVAL_QUERY');
  }

  embedDocument(text: string): Promise<number[]> {
    return this.embed(text, 'RETRIEVAL_DOCUMENT');
  }

  private async embed(
    text: string,
    taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT',
  ): Promise<number[]> {
    const result = await this.client.models.embedContent({
      model: this.model,
      contents: text,
      config: { taskType, outputDimensionality: this.dim },
    });
    const values = result.embeddings?.[0]?.values;
    if (!values || values.length === 0) {
      throw new Error('Gemini embedding API returned no values.');
    }
    return values;
  }
}
