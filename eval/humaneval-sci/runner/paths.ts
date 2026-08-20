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
import fs from 'node:fs';
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

/**
 * The Python interpreter used to execute candidate and reference code.
 *
 * Both scorers spawn it with `-I` (isolated mode), which is deliberate for
 * running model-generated code but also strips **user** site-packages from
 * `sys.path`. A `pip install --user numpy` is therefore invisible to the
 * harness, and every candidate that imports numpy — the correct choice for
 * scientific Python — is scored as a hard failure rather than as code the
 * harness could not run.
 *
 * Point this at a virtualenv to keep the isolation and supply the scientific
 * stack: a venv's site-packages is not user site, so it survives `-I`.
 *
 *   HUMANEVAL_SCI_PYTHON=/path/to/.venv/bin/python
 */
export function pythonBin(): string {
  if (process.env.HUMANEVAL_SCI_PYTHON) return process.env.HUMANEVAL_SCI_PYTHON;
  // Auto-detect a venv sitting in this package. Requiring an env var makes
  // correctness depend on remembering, and remembering is exactly what failed
  // here for three months — silently, because the broken path still produced
  // complete-looking results.
  const local = path.join(evalRoot, '.venv', 'bin', 'python');
  if (fs.existsSync(local)) return local;
  return 'python3';
}
