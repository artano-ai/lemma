// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Refuse to score against a Python that cannot run the reference solutions.
 *
 * Both scorers execute code with `python -I`. Isolated mode is deliberate for
 * running model-generated code, but it drops **user** site-packages from
 * `sys.path` — so a `pip install --user numpy` is invisible to the harness
 * while working perfectly at a shell.
 *
 * When that happened, nothing failed. Candidates that imported numpy — the
 * correct choice for scientific Python — were recorded as hard import failures
 * and scored 0, so the harness emitted 73 complete results that were wrong by
 * 14 points of functional pass rate, and the defect survived from May to
 * August unnoticed.
 *
 * This module makes that condition loud. It is the harness-level form of the
 * rule the engine already enforces on verdicts: **"cannot check" must never be
 * reported as "checked, and it failed."** A run that cannot execute the
 * reference has no business emitting scores at all.
 */
import { execFileSync } from 'node:child_process';

/**
 * Modules the benchmark's own reference solutions import. If the interpreter
 * cannot load these, the reference cannot run, so no candidate can be
 * meaningfully compared against it.
 *
 * `math` is stdlib and always present; numpy is the one that goes missing, and
 * is imported by 7 of the 73 reference solutions.
 */
export const REQUIRED_MODULES = ['math', 'numpy'] as const;

/** Interpreters already verified this process, so we probe each one once. */
const verified = new Set<string>();

export interface PreflightOptions {
  /** Re-probe even if this interpreter was already checked (tests). */
  force?: boolean;
}

/**
 * Throw unless `bin` can import every required module **under `-I`**.
 *
 * The `-I` is load-bearing and not a detail: a probe without it passes against
 * exactly the interpreter that fails inside the harness, which is how this
 * went unnoticed for three months.
 */
export function assertPythonEnv(bin: string, options: PreflightOptions = {}): void {
  if (!options.force && verified.has(bin)) return;

  const missing: string[] = [];
  for (const mod of REQUIRED_MODULES) {
    try {
      execFileSync(bin, ['-I', '-c', `import ${mod}`], { stdio: 'ignore' });
    } catch {
      missing.push(mod);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Python preflight failed: ${bin} cannot import ${missing.join(', ')} under -I.\n` +
        '\n' +
        'The scorers run candidate code with `python -I` (isolated mode), which\n' +
        'removes USER site-packages from sys.path. A `pip install --user numpy`\n' +
        'therefore works at a shell but is invisible here.\n' +
        '\n' +
        'Refusing to score rather than reporting every numpy-importing candidate\n' +
        'as a hard failure — those are not the same result, and the second one is\n' +
        'indistinguishable from real physics errors once it reaches a run record.\n' +
        '\n' +
        'Fix (a venv survives -I, because its site-packages is not user site):\n' +
        '  python3 -m venv .venv\n' +
        '  ./.venv/bin/python -m pip install numpy scipy\n' +
        '  export HUMANEVAL_SCI_PYTHON="$PWD/.venv/bin/python"\n',
    );
  }
  verified.add(bin);
}
