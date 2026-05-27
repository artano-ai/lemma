/**
 * Differential scorer — probes the candidate function across a sweep
 * of inputs derived from the prompt's test cases, runs the reference
 * solution on the same inputs, and reports per-probe agreement.
 *
 * Why this exists: `scoreVerification` alone evaluates the prompt's
 * pre-declared `verification_targets` — identical for control and
 * treatment. The harness needed a per-candidate signal independent
 * of the narrow `functional` test set. Differential is that signal:
 *
 *   - Reference passes a probe, candidate fails → candidate diverges
 *     from the canonical formula on inputs the tests didn't cover.
 *     Severity bump.
 *   - Reference passes, candidate also passes → candidate is
 *     consistent with the reference's behavior across the probe sweep.
 *     Severity stays low.
 *
 * Combined with the existing claim-recorded checks (dimensional,
 * limit, conservation — currently warn-only pending symbolic
 * verification), the verification verdict now reflects the
 * candidate's actual numerical behavior, not just the prompt's
 * declared targets.
 *
 * v0 probe generation: each non-exception test case contributes its
 * original `inputs` PLUS four perturbed variants (each numerical
 * input scaled by {0.7, 0.9, 1.1, 1.3} independently). Ratio tests
 * contribute `inputs_a` and `inputs_b`. Exception tests are skipped
 * (they would just trigger raises on both arms).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PromptDefinition, Severity, TestCase } from './types.js';

export interface DifferentialOptions {
  /** Relative tolerance for output agreement. */
  rtol?: number;
  /** Absolute tolerance for output agreement. */
  atol?: number;
  /** Wall-clock cap on the entire differential subprocess. */
  timeoutMs?: number;
  /** Python interpreter. Default: python3. */
  pythonBin?: string;
}

export interface DifferentialDetail {
  name: string;
  severity: Severity;
  detail: string;
}

export interface DifferentialResult {
  /** Worst severity across all probes. NONE when every probe agrees,
   *  HIGH when every probe disagrees. */
  severity: Severity;
  /** Number of probes where candidate and reference agreed (within tol). */
  passing: number;
  /** Total probes attempted (skipped probes — where reference itself
   *  raises — are excluded from this count). */
  total: number;
  /** Per-probe and per-issue detail lines, severity-tagged. */
  details: DifferentialDetail[];
}

const DEFAULTS: Required<DifferentialOptions> = {
  rtol: 1e-3,
  atol: 1e-6,
  timeoutMs: 15_000,
  pythonBin: 'python3',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_PATH = path.resolve(here, 'python-harness.py');

export async function scoreDifferential(
  prompt: PromptDefinition,
  candidateCode: string,
  options: DifferentialOptions = {},
): Promise<DifferentialResult> {
  const opts = { ...DEFAULTS, ...options };

  const functionName = extractFunctionName(prompt);
  if (!functionName) {
    return {
      severity: 'LOW',
      passing: 0,
      total: 0,
      details: [
        {
          name: 'differential.setup',
          severity: 'LOW',
          detail: 'Could not extract function name; differential check skipped.',
        },
      ],
    };
  }

  const probes = buildProbes(prompt);
  if (probes.length === 0) {
    // Nothing to differentially probe (e.g. all test cases are
    // exception-shaped). Return a neutral non-severity result.
    return {
      severity: 'NONE',
      passing: 0,
      total: 0,
      details: [
        {
          name: 'differential.no_probes',
          severity: 'NONE',
          detail: 'No numerical probes derivable from prompt test cases.',
        },
      ],
    };
  }

  const payload = JSON.stringify({
    mode: 'differential',
    code: candidateCode,
    reference_code: prompt.reference_solution,
    function_name: functionName,
    probes,
    rtol: opts.rtol,
    atol: opts.atol,
  });

  const harnessOutput = await callHarness(payload, opts);

  if (harnessOutput.fatal) {
    // Either the candidate or reference failed to import. That's a
    // hard scientific-correctness failure on the candidate's part.
    return {
      severity: 'HIGH',
      passing: 0,
      total: probes.length,
      details: [
        {
          name: 'differential.import_failure',
          severity: 'HIGH',
          detail: harnessOutput.fatal,
        },
      ],
    };
  }

  let passing = 0;
  let attempted = 0;
  const details: DifferentialDetail[] = [];
  for (const r of harnessOutput.results) {
    if (r.passed === null) {
      // Probe skipped because reference itself couldn't evaluate.
      details.push({
        name: 'differential.probe_skipped',
        severity: 'NONE',
        detail: `${stringifyInputs(r.inputs)}: ${r.reason}`,
      });
      continue;
    }
    attempted++;
    if (r.passed) {
      passing++;
    } else {
      details.push({
        name: 'differential.probe_failed',
        severity: 'MEDIUM',
        detail: `${stringifyInputs(r.inputs)}: ${r.reason}`,
      });
    }
  }

  const passRate = attempted === 0 ? 1 : passing / attempted;
  const severity: Severity =
    passRate >= 0.95 ? 'NONE'
    : passRate >= 0.7 ? 'LOW'
    : passRate >= 0.3 ? 'MEDIUM'
    : 'HIGH';

  details.unshift({
    name: 'differential.summary',
    severity,
    detail: `${passing}/${attempted} probes matched reference within rtol=${opts.rtol}, atol=${opts.atol}`,
  });

  return { severity, passing, total: attempted, details };
}

interface DifferentialReport {
  fatal: string | null;
  results: Array<{
    inputs: Record<string, unknown>;
    passed: boolean | null;
    reason: string;
  }>;
}

async function callHarness(
  payload: string,
  opts: Required<DifferentialOptions>,
): Promise<DifferentialReport> {
  return new Promise<DifferentialReport>((resolve) => {
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

    proc.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    proc.stderr.on('data', (chunk) => (stderr += chunk.toString()));

    proc.on('error', (err) =>
      resolve({ fatal: `failed to spawn python: ${err.message}`, results: [] }),
    );

    proc.on('close', () => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          fatal: `differential probe timed out after ${opts.timeoutMs}ms`,
          results: [],
        });
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed as DifferentialReport);
      } catch (e) {
        resolve({
          fatal: `harness output unparseable: ${stderr || stdout || (e as Error).message}`,
          results: [],
        });
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/** Build a probe set from the prompt's test cases. */
function buildProbes(prompt: PromptDefinition): Array<{ inputs: Record<string, unknown> }> {
  const out: Array<{ inputs: Record<string, unknown> }> = [];
  const seenKeys = new Set<string>();

  const push = (inputs: Record<string, unknown>) => {
    const key = JSON.stringify(inputs);
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    out.push({ inputs });
  };

  for (const tc of prompt.test_cases) {
    if (isExceptionCase(tc)) continue;

    if (tc.inputs_a && tc.inputs_b) {
      push(tc.inputs_a);
      push(tc.inputs_b);
      continue;
    }

    const baseInputs = tc.inputs;
    if (!baseInputs) continue;
    push(baseInputs);

    // Perturb each numerical input independently by {0.7, 0.9, 1.1, 1.3}.
    // Skips list / non-numeric inputs (free-fall's `t` array, exception
    // edge values etc.).
    for (const scale of [0.7, 0.9, 1.1, 1.3]) {
      const perturbed: Record<string, unknown> = { ...baseInputs };
      let changed = false;
      for (const [k, v] of Object.entries(baseInputs)) {
        if (typeof v === 'number' && Number.isFinite(v) && v !== 0) {
          perturbed[k] = v * scale;
          changed = true;
        }
      }
      if (changed) push(perturbed);
    }
  }

  return out;
}

function isExceptionCase(tc: TestCase): boolean {
  return (
    typeof tc.expected === 'object' &&
    tc.expected !== null &&
    'raises' in tc.expected
  );
}

function stringifyInputs(inputs: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(inputs)) {
    parts.push(`${k}=${typeof v === 'number' ? v : JSON.stringify(v)}`);
  }
  return parts.join(', ');
}

/** Pull the function name from the reference solution. Mirrors the
 *  same regex used by the functional scorer. */
function extractFunctionName(prompt: PromptDefinition): string | null {
  const m = prompt.reference_solution.match(
    /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/m,
  );
  return m ? m[1]! : null;
}
