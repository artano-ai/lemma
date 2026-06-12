// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

import {
  type Embedder,
  type EmbedderConfig,
  type EmbedderProvider,
  makeEmbedder,
} from './embedder/index.js';
import type { Dtype, Pooling } from './embedder/transformers.js';

let cached: { key: string; embedderP: Promise<Embedder> } | undefined;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envStr(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export function configFromEnv(): EmbedderConfig {
  const provider = envStr('LEMMA_EMBEDDING_PROVIDER', 'transformers') as EmbedderProvider;
  const dim = envInt('LEMMA_EMBEDDING_DIM', 768);

  if (provider === 'transformers') {
    return {
      provider: 'transformers',
      model: envStr('LEMMA_TRANSFORMERS_MODEL', 'onnx-community/Qwen3-Embedding-0.6B-ONNX'),
      dtype: envStr('LEMMA_TRANSFORMERS_DTYPE', 'q8') as Dtype,
      pooling: envStr('LEMMA_TRANSFORMERS_POOLING', 'last_token') as Pooling,
      instruction: envStr('LEMMA_TRANSFORMERS_INSTRUCTION', '') || undefined,
      dim,
    };
  }

  return {
    provider: 'gemini',
    apiKey: envStr('LEMMA_GEMINI_API_KEY', ''),
    model: envStr('LEMMA_GEMINI_EMBEDDING_MODEL', 'gemini-embedding-001'),
    dim,
  };
}

export async function getEmbedder(): Promise<Embedder> {
  const config = configFromEnv();
  const key = JSON.stringify(config);
  if (!cached || cached.key !== key) {
    cached = { key, embedderP: makeEmbedder(config) };
  }
  return cached.embedderP;
}
