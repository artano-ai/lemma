import type { Embedder, EmbedderProvider } from './index.js';
import { truncateAndNormalize } from './index.js';

export type Pooling = 'last_token' | 'mean' | 'cls';
export type Dtype = 'fp32' | 'fp16' | 'q8';

export interface TransformersConfig {
  model: string;
  dtype: Dtype;
  pooling: Pooling;
  dim: number;
  instruction?: string;
}

const pipelineCache = new Map<string, Promise<FeatureExtractionPipeline>>();

interface FeatureExtractionPipeline {
  (
    inputs: string | string[],
    options?: { pooling?: Pooling; normalize?: boolean },
  ): Promise<{ data: Float32Array; dims: number[]; tolist(): number[][] }>;
}

async function getPipeline(model: string, dtype: Dtype): Promise<FeatureExtractionPipeline> {
  const key = `${model}::${dtype}`;
  let entry = pipelineCache.get(key);
  if (!entry) {
    entry = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return (await pipeline('feature-extraction', model, { dtype })) as unknown as FeatureExtractionPipeline;
    })();
    pipelineCache.set(key, entry);
  }
  return entry;
}

function formatQuery(text: string, instruction: string | undefined): string {
  if (!instruction) return text;
  return `Instruct: ${instruction}\nQuery:${text}`;
}

export class TransformersEmbedder implements Embedder {
  readonly provider: EmbedderProvider = 'transformers';
  readonly dim: number;
  private readonly model: string;
  private readonly dtype: Dtype;
  private readonly pooling: Pooling;
  private readonly instruction: string | undefined;

  constructor(config: TransformersConfig) {
    this.model = config.model;
    this.dtype = config.dtype;
    this.pooling = config.pooling;
    this.dim = config.dim;
    this.instruction = config.instruction?.trim() || undefined;
  }

  async embedQuery(text: string): Promise<number[]> {
    const formatted = formatQuery(text, this.instruction);
    return this.embed(formatted);
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private async embed(text: string): Promise<number[]> {
    const extractor = await getPipeline(this.model, this.dtype);
    const output = await extractor(text, {
      pooling: this.pooling,
      normalize: true,
    });
    const full = Array.from(output.data) as number[];
    if (full.length === this.dim) return full;
    return truncateAndNormalize(full, this.dim);
  }
}
