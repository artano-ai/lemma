// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Functional scorer — runs reference test cases against generated code.
 *
 * Python: dispatches to a sandboxed subprocess (`python3 -I`) that
 * exec()'s the candidate code in an isolated namespace and matches
 * the result against the test-case's expected shape. The harness
 * script lives at `scorer/python-harness.py`.
 *
 * Security note: every generated snippet is untrusted. `python3 -I`
 * + a wall-clock SIGKILL timeout stops curious mistakes, not a
 * determined attacker. Production deployments must run this inside
 * a containerised sandbox (Docker / Firejail / Wasm) with no network
 * and a strict CPU/memory budget. Treat the current setup as adequate
 * for benchmarking trusted prompts during development.
 *
 * Other languages (Fortran / C++ / Julia / Matlab) are not yet wired.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FunctionalScore, PromptDefinition, TestCase } from './types.js';

export interface RunnerOptions {
  /** Hard cap on wall time per test case, milliseconds. */
  timeoutMs?: number;
  /** Path to a Python interpreter. Default: python3 on $PATH. */
  pythonBin?: string;
  /** When true, skip subprocess execution and only compare candidate
   *  source against the reference verbatim. Useful for fast scorer
   *  unit checks; produces false negatives on any real LLM output. */
  skeletonMode?: boolean;
}

const DEFAULTS: Required<RunnerOptions> = {
  timeoutMs: 10_000,
  pythonBin: 'python3',
  skeletonMode: false,
};

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = path.resolve(here, 'python-harness.py');

export async function scoreFunctional(
  prompt: PromptDefinition,
  candidateCode: string,
  options: RunnerOptions = {},
): Promise<FunctionalScore> {
  const opts = { ...DEFAULTS, ...options };
  const failures: FunctionalScore['failures'] = [];
  let passed = 0;

  for (const tc of prompt.test_cases) {
    try {
      const verdict = await runOne(prompt, candidateCode, tc, opts);
      if (verdict.ok) passed++;
      else failures.push({ test_case: tc.name, reason: verdict.reason });
    } catch (err) {
      failures.push({
        test_case: tc.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const total = prompt.test_cases.length;
  return {
    passed,
    total,
    pass_rate: total === 0 ? 0 : passed / total,
    failures,
  };
}

interface TestVerdict {
  ok: boolean;
  reason: string;
}

async function runOne(
  prompt: PromptDefinition,
  candidateCode: string,
  testCase: TestCase,
  opts: Required<RunnerOptions>,
): Promise<TestVerdict> {
  if (opts.skeletonMode) {
    const ok = candidateCode.trim() === prompt.reference_solution.trim();
    return {
      ok,
      reason: ok ? '' : 'skeleton-mode source mismatch',
    };
  }
  if (prompt.language === 'python') {
    return runPython(prompt, candidateCode, testCase, opts);
  }
  throw new Error(`Language not yet supported: ${prompt.language}`);
}

async function runPython(
  prompt: PromptDefinition,
  candidateCode: string,
  testCase: TestCase,
  opts: Required<RunnerOptions>,
): Promise<TestVerdict> {
  const functionName = extractFunctionName(prompt);
  if (!functionName) {
    return {
      ok: false,
      reason:
        'could not locate a `def <name>(` in the candidate or reference solution',
    };
  }

  if (!fs.existsSync(HARNESS_PATH)) {
    return {
      ok: false,
      reason: `python harness missing at ${HARNESS_PATH}`,
    };
  }

  const payload = JSON.stringify({
    code: candidateCode,
    function_name: functionName,
    test_case: testCase,
  });

  return new Promise<TestVerdict>((resolve) => {
    const proc = spawn(opts.pythonBin, ['-I', HARNESS_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, opts.timeoutMs);

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        reason: `failed to spawn python: ${err.message}`,
      });
    });

    proc.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          ok: false,
          reason: `timeout after ${opts.timeoutMs}ms (SIGKILL'd)`,
        });
        return;
      }
      const out = (stdout || '').trim();
      const firstLine = out.split('\n')[0] ?? '';
      if (exitCode === 0 && firstLine === 'PASS') {
        resolve({ ok: true, reason: '' });
        return;
      }
      const reason =
        firstLine.startsWith('FAIL:')
          ? firstLine.slice('FAIL:'.length).trim()
          : stderr.trim() || `python exited ${exitCode} with output: ${out}`;
      resolve({ ok: false, reason });
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/** Locate the function name to invoke. Prefer the candidate's first
 *  `def`, fall back to the reference solution if the candidate is
 *  malformed (e.g. only emitted a class or wrapped output). */
function extractFunctionName(prompt: PromptDefinition): string | null {
  return matchFirstDef(prompt.reference_solution);
}

function matchFirstDef(source: string): string | null {
  const m = source.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m);
  return m ? m[1]! : null;
}
