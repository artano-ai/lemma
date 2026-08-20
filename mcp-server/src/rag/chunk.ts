// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Split a document into passages for embedding.
 *
 * Kept a **pure function** deliberately: it is the only part of ingestion that
 * has interesting behaviour, and everything else (embedding, inserting) needs a
 * model download and a live Postgres. Keeping the logic here means it can be
 * tested properly, which is why `rag_lookup` was previously untestable end to
 * end and stayed unverified for so long.
 *
 * ## What it optimises for
 *
 * Retrieval quality is mostly decided here, not in the search. Two properties
 * matter more than cleverness:
 *
 * 1. **Do not split mid-sentence.** A passage that starts halfway through a
 *    clause embeds badly and reads worse when handed to a model as evidence.
 * 2. **Overlap.** A fact that straddles a boundary is otherwise retrievable by
 *    neither neighbour. The overlap costs storage and buys recall.
 *
 * It splits on paragraph boundaries first, then sentence boundaries, and only
 * falls back to a hard character cut for a single unbroken run longer than the
 * target — a minified file, a base64 blob, a table with no spaces. That case
 * gets chunked bluntly rather than skipped, because silently dropping input is
 * worse than chunking it badly.
 */

export interface ChunkOptions {
  /** Target characters per chunk. Not a hard cap — a sentence is never split. */
  targetChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number;
}

export interface Chunk {
  text: string;
  /** 0-based position in the source document, kept so hits can be ordered. */
  index: number;
}

const DEFAULT_TARGET = 1_200;
const DEFAULT_OVERLAP = 150;

/** Split into paragraphs, then sentences, keeping terminators attached. */
function segments(text: string): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n\s*\n/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    // Sentence terminator followed by whitespace and a capital / digit / quote.
    // Deliberately conservative: over-splitting is cheap, and a missed split
    // just yields a longer segment that the packer handles anyway.
    const sentences = trimmed.split(/(?<=[.!?])\s+(?=["'(\[]?[A-Z0-9])/);
    for (const s of sentences) {
      const t = s.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Hard-split a segment that is itself longer than the target. */
function hardSplit(segment: string, size: number): string[] {
  const parts: string[] = [];
  for (let i = 0; i < segment.length; i += size) {
    parts.push(segment.slice(i, i + size));
  }
  return parts;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const target = Math.max(1, options.targetChars ?? DEFAULT_TARGET);
  // Overlap must be strictly smaller than the target, or the carried tail
  // refills the next chunk to the boundary and the packer makes no progress.
  const overlap = Math.min(Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP), target - 1);

  const pieces: string[] = [];
  for (const segment of segments(text)) {
    if (segment.length > target) pieces.push(...hardSplit(segment, target));
    else pieces.push(segment);
  }

  const chunks: Chunk[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push({ text: trimmed, index: chunks.length });
  };

  for (const piece of pieces) {
    if (current && current.length + 1 + piece.length > target) {
      flush();
      // Carry the tail of the emitted chunk so a fact spanning the boundary is
      // retrievable from the following chunk too.
      current = overlap > 0 ? current.slice(-overlap).trimStart() : '';
    }
    current = current ? `${current} ${piece}` : piece;
  }
  flush();

  return chunks;
}

/**
 * A stable identity for a passage, used to make re-ingesting a source replace
 * rather than duplicate.
 *
 * Content-based rather than positional: editing a document's first paragraph
 * would shift every subsequent index, so a positional key would orphan every
 * later chunk and leave the old copies behind.
 */
export function contentKey(text: string): string {
  // FNV-1a, 64-bit. Not cryptographic — this only needs to be stable, cheap,
  // and collision-resistant enough that two distinct passages in one document
  // do not share a key.
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
