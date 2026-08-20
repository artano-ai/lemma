// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * The Python interpreter the scorers execute candidate code with.
 *
 * Run: `pnpm test-python-env`
 *
 * Both scorers spawn `python -I` — isolated mode, which is deliberate: it runs
 * model-generated code with the script directory, the environment, and the
 * *user* site-packages all off `sys.path`. The catch is that `pip install
 * --user` puts numpy in exactly that user site-packages, so an interpreter
 * that imports numpy fine at a shell cannot import it under `-I`.
 *
 * The observed cost of that mismatch: 64 candidates in the Qwen 32B rerank
 * record scored a hard failure on `ModuleNotFoundError: numpy`, and 10 of the
 * 12 prompts where every candidate scored zero failed for that reason rather
 * than for anything scientific. Writing `import numpy` is the *correct* choice
 * for scientific Python; the harness was marking it catastrophically wrong.
 *
 * The fix keeps isolation and supplies the dependency: point the harness at a
 * virtualenv, whose site-packages is not user site and so survives `-I`.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { pythonBin } from '../runner/paths.js';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

console.log('python environment');

check('HUMANEVAL_SCI_PYTHON overrides the interpreter', () => {
  const prev = process.env.HUMANEVAL_SCI_PYTHON;
  process.env.HUMANEVAL_SCI_PYTHON = '/custom/python';
  try {
    assert.equal(pythonBin(), '/custom/python');
  } finally {
    if (prev === undefined) delete process.env.HUMANEVAL_SCI_PYTHON;
    else process.env.HUMANEVAL_SCI_PYTHON = prev;
  }
});

check('auto-detects the repo-local .venv when the env var is unset', () => {
  // The env var is a remembering problem, and remembering is what failed for
  // three months. If the venv is sitting right there, just use it.
  const prev = process.env.HUMANEVAL_SCI_PYTHON;
  delete process.env.HUMANEVAL_SCI_PYTHON;
  try {
    assert.match(pythonBin(), /\.venv[/\\]bin[/\\]python$/);
  } finally {
    if (prev !== undefined) process.env.HUMANEVAL_SCI_PYTHON = prev;
  }
});

check('the configured interpreter can import numpy UNDER -I', () => {
  // The whole point. A check that omits `-I` would pass against the very
  // interpreter that fails in the harness, which is how this went unnoticed.
  const bin = pythonBin();
  const out = execFileSync(bin, ['-I', '-c', 'import numpy; print(numpy.__version__)'], {
    encoding: 'utf-8',
  }).trim();
  assert.match(out, /^\d+\./, `expected a numpy version, got "${out}"`);
});

check('the reference solutions’ imports all resolve under -I', () => {
  // 27 of the 73 reference solutions import `math`, 7 import `numpy`. If the
  // *reference* cannot run, the differential has no baseline and every
  // candidate on that prompt is scored against nothing.
  const bin = pythonBin();
  execFileSync(bin, ['-I', '-c', 'import math, numpy'], { encoding: 'utf-8' });
});

check('pythonBin reports a real, resolvable interpreter', () => {
  // Provenance guard. The rescore emitter records pythonBin() into every
  // derived record, and the cross-model pooling check refuses to combine
  // records whose interpreter disagrees. An emitter that logged the *env var*
  // instead labelled an auto-detected venv run as "python3 (default)" — a
  // provenance field that misstates which interpreter produced the numbers,
  // and one that would have blocked a legitimate pool.
  const bin = pythonBin();
  assert.ok(bin.length > 0);
  const shown = execFileSync(bin, ['-I', '-c', 'import sys; print(sys.executable)'], {
    encoding: 'utf-8',
  }).trim();
  assert.ok(shown.length > 0, 'interpreter did not report its own path');
});

console.log(`\n${passed} checks passed`);
