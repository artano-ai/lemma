// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Runtime path resolution for the eval harness.
 *
 * The harness consumes two external inputs and writes one output:
 *   - the cards corpus (the engine reads it; point LEMMA_CARDS_DIR at it)
 *   - the benchmark prompts (a separate distribution; supplied at runtime
 *     via HUMANEVAL_SCI_PROMPTS_DIR so it is not pinned to a fixed layout)
 *   - run output, written under this package's own results/ directory;
 *     promote notable runs to the benchmark's landmark set by hand.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** This package's root directory (one level up from runner/). */
export const evalRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The benchmark prompts directory. Required at runtime — the prompt set
 * is distributed separately, so its location is supplied by the caller
 * rather than assumed.
 */
export function promptsDir(): string {
  const dir = process.env.HUMANEVAL_SCI_PROMPTS_DIR;
  if (!dir) {
    throw new Error(
      'HUMANEVAL_SCI_PROMPTS_DIR is not set. Point it at the benchmark ' +
        'prompts directory, e.g.\n' +
        '  HUMANEVAL_SCI_PROMPTS_DIR=/path/to/prompts pnpm smoke-ab',
    );
  }
  return path.resolve(dir);
}

/** Local scratch for run output. */
export const resultsDir = path.join(evalRoot, 'results');
