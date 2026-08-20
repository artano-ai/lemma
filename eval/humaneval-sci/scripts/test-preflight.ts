// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * The harness must REFUSE TO RUN against a Python that cannot import what the
 * reference solutions need.
 *
 * Run: `pnpm test-preflight`
 *
 * This exists because the alternative is what actually happened. Both scorers
 * spawn `python -I`, isolated mode drops user site-packages, numpy became
 * unimportable — and nothing failed. Every candidate that imported numpy was
 * scored a hard failure instead, so the harness produced 73 complete,
 * plausible-looking results that were wrong by 14 points on the functional
 * pass rate. It went unnoticed from May to August.
 *
 * A crash would have been found the same afternoon. The rule the engine
 * already enforces for verdicts — "cannot check" must never be reported as
 * "checked, and it failed" — applies to the harness itself: a run that cannot
 * execute the reference must not emit scores as though it had.
 */

import assert from 'node:assert/strict';

import { assertPythonEnv, REQUIRED_MODULES } from '../scorer/preflight.js';
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

console.log('preflight');

check('refuses an interpreter that cannot import numpy', () => {
  // The exact failure that shipped: numpy present at a shell, invisible under -I.
  assert.throws(
    () => assertPythonEnv('python3', { force: true }),
    /numpy/,
    'expected a refusal naming the missing module',
  );
});

check('the refusal explains how to fix it', () => {
  // A refusal that does not say what to do is a worse bug report than a crash.
  try {
    assertPythonEnv('python3', { force: true });
    assert.fail('should have thrown');
  } catch (err) {
    const m = (err as Error).message;
    assert.match(m, /HUMANEVAL_SCI_PYTHON/, 'does not name the env var');
    assert.match(m, /venv/, 'does not mention the venv remedy');
    assert.match(m, /-I|isolated/, 'does not explain WHY it is missing');
  }
});

check('accepts the resolved interpreter — no env var needed', () => {
  // Uses the same resolution the scorers use, so this passes on a clean shell
  // with nothing exported. If it fails, the harness is genuinely unrunnable.
  assertPythonEnv(pythonBin(), { force: true });
});

check('refuses a python that does not exist at all', () => {
  assert.throws(() => assertPythonEnv('/nonexistent/python', { force: true }));
});

check('numpy is among the required modules', () => {
  assert.ok(REQUIRED_MODULES.includes('numpy'));
});

console.log(`\n${passed} checks passed`);
