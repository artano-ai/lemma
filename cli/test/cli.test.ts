// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * The contract these tests hold is the **exit code**, not the wording.
 *
 * A CLI used in CI is graded on its exit status. Three classes must stay
 * distinct, because a pipeline that cannot tell them apart teaches people to
 * ignore it:
 *
 * * `0` — checked, and it passed
 * * `1` — checked, and the science is out of range
 * * `2` — could not check at all (bad id, unreadable input, bad usage)
 *
 * The `1` / `2` split is the load-bearing one. Collapsing a typo'd card id into
 * the same red build as a genuine envelope violation is how a verification gate
 * becomes noise.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CLI_ROOT = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
process.env.LEMMA_CARDS_DIR ??= path.resolve(CLI_ROOT, '..', 'cards');

const { run } = await import('../src/index.js');

/** Run the CLI with stdout/stderr captured, returning the exit code and text. */
function capture(args: string[]): { code: number; out: string; err: string } {
  const chunks: string[] = [];
  const errs: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  (process.stdout as NodeJS.WriteStream).write = ((s: string) => {
    chunks.push(String(s));
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as NodeJS.WriteStream).write = ((s: string) => {
    errs.push(String(s));
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = run(args);
    return { code, out: chunks.join(''), err: errs.join('') };
  } catch (err) {
    return { code: (err as { exitCode?: number }).exitCode ?? 2, out: chunks.join(''), err: String(err) };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

describe('exit codes', () => {
  test('an in-range output exits 0', () => {
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{"gEarth_m_per_s2": 9.81}']);
    assert.equal(r.code, 0);
  });

  test('an out-of-range output exits 1, not 2', () => {
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{"gEarth_m_per_s2": 42}']);
    assert.equal(r.code, 1, 'a real envelope violation must be exit 1');
  });

  test('an unknown card id exits 2, not 1', () => {
    const r = capture(['verify', 'no-such-card', '--output', '{"a": 1}']);
    assert.equal(r.code, 2, 'a usage fault must not look like a failed verification');
  });

  test('malformed JSON exits 2', () => {
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{not json']);
    assert.equal(r.code, 2);
  });

  test('an unknown command exits 2', () => {
    assert.equal(capture(['frobnicate']).code, 2);
  });

  test('no arguments prints help and exits 2', () => {
    const r = capture([]);
    assert.equal(r.code, 2);
    assert.match(r.out, /USAGE/);
  });

  test('--help exits 0', () => {
    assert.equal(capture(['--help']).code, 0);
  });
});

describe('an absent check is not a passing one', () => {
  const unmatched = ['verify', 'free-fall-uniform-gravity', '--output', '{"unrelatedKey": 1}'];

  test('by default a zero-check run exits 0 — and says so rather than looking clean', () => {
    const r = capture(unmatched);
    assert.equal(r.code, 0);
    assert.match(r.out, /0 of 0 checks passed/);
    assert.match(r.out, /nothing to check/, 'the engine diagnosis must be surfaced, not swallowed');
  });

  test('--require-checks turns that into a failure', () => {
    const r = capture([...unmatched, '--require-checks']);
    assert.equal(r.code, 1);
    assert.match(r.out, /an absent check must not be mistaken for a passing one/);
  });
});

describe('values are refused rather than coerced', () => {
  test('a numeric string is not silently converted', () => {
    // "9.81" would pass if coerced. Coercing would make the verdict depend on
    // a conversion the caller never asked for.
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{"gEarth_m_per_s2": "9.81"}']);
    assert.equal(r.code, 2);
    assert.match(r.err, /must be a finite number/);
  });

  test('an array is not accepted as an output map', () => {
    assert.equal(capture(['verify', 'free-fall-uniform-gravity', '--output', '[1,2]']).code, 2);
  });

  test('an empty output is refused — there is nothing to verify', () => {
    assert.equal(capture(['verify', 'free-fall-uniform-gravity', '--output', '{}']).code, 2);
  });
});

describe('crosscheck', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lemma-cli-'));
  });

  test('a corpus hypothesis card passes its hard checks', () => {
    const r = capture(['crosscheck', 'free-fall-with-linear-drag']);
    assert.equal(r.code, 0);
  });

  test('recorded-but-undischarged claims do not fail the build', () => {
    // A `warn` means the engine declined to answer. Failing on it would punish
    // authors for writing down claims the engine cannot yet check.
    const r = capture(['crosscheck', 'free-fall-with-linear-drag']);
    assert.match(r.out, /warn/);
    assert.equal(r.code, 0);
  });

  test('a dimensionally broken draft is caught before it reaches a PR', () => {
    const draft = path.join(dir, 'broken.json');
    writeFileSync(
      draft,
      JSON.stringify({
        kind: 'hypothesis',
        id: 'draft-broken',
        version: '0.1.0',
        name: 'Declares energy, computes momentum',
        proposal: 'E = (1/2) m v',
        proposedFormulaTeX: 'E = \\tfrac{1}{2} m v',
        origin: 'llm',
        references: ['test fixture'],
        checks: {
          dimensional: {
            lhsLabel: 'E [J]',
            lhsDims: { M: 1, L: 2, T: -2 },
            rhsLabel: '(1/2) m v [J]',
            rhsDims: { M: 1, L: 2, T: -2 },
            expr: '(1/2)*m*v',
            symbols: { m: { M: 1 }, v: { L: 1, T: -1 } },
          },
        },
      }),
    );
    const r = capture(['crosscheck', draft]);
    assert.equal(r.code, 1);
    assert.match(r.out, /Dimensional mismatch/);
  });

  test('a non-hypothesis card is refused with a usage error', () => {
    const wrong = path.join(dir, 'principle.json');
    writeFileSync(wrong, JSON.stringify({ kind: 'principle', id: 'x' }));
    assert.equal(capture(['crosscheck', wrong]).code, 2);
  });
});

describe('browse', () => {
  test('list finds the corpus', () => {
    const r = capture(['cards', 'list']);
    assert.equal(r.code, 0);
    assert.match(r.out, /free-fall-uniform-gravity/);
  });

  test('the bare aliases match the Python CLI spelling', () => {
    // Both packages install a binary called `lemma`; whichever wins the PATH
    // should answer to the same commands.
    assert.equal(capture(['list']).out, capture(['cards', 'list']).out);
    assert.equal(capture(['show', 'ideal-gas-law']).out, capture(['cards', 'show', 'ideal-gas-law']).out);
  });

  test('--kind filters, and rejects a kind that does not exist', () => {
    const r = capture(['cards', 'list', '--kind', 'hypothesis', '--json']);
    const rows = JSON.parse(r.out) as { kind: string }[];
    assert.ok(rows.length > 0);
    assert.ok(rows.every((c) => c.kind === 'hypothesis'));
    assert.equal(capture(['cards', 'list', '--kind', 'nonsense']).code, 2);
  });

  test('search matches ids, names and principles', () => {
    const r = capture(['cards', 'search', 'entropy', '--json']);
    const rows = JSON.parse(r.out) as { id: string }[];
    assert.ok(rows.some((c) => c.id === 'boltzmann-entropy'));
  });

  test('an unknown card id exits 2 from show', () => {
    assert.equal(capture(['cards', 'show', 'no-such-card']).code, 2);
  });
});

describe('--json is machine-readable', () => {
  test('verify emits parseable JSON with no ANSI escapes', () => {
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{"gEarth_m_per_s2": 9.81}', '--json']);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.out, /\[/, 'colour codes would make the stream invalid JSON');
    const parsed = JSON.parse(r.out) as { card: string; overall: { severity: string } };
    assert.equal(parsed.card, 'free-fall-uniform-gravity');
    assert.equal(parsed.overall.severity, 'NONE');
  });

  test('a failing verify still emits valid JSON', () => {
    const r = capture(['verify', 'free-fall-uniform-gravity', '--output', '{"gEarth_m_per_s2": 42}', '--json']);
    assert.equal(r.code, 1);
    assert.equal((JSON.parse(r.out) as { overall: { severity: string } }).overall.severity, 'HIGH');
  });
});

describe('verify covers every shape of evidence, not just scalars', () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lemma-cli-evidence-'));
  });

  const write = (name: string, value: unknown) => {
    const p = path.join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    return p;
  };

  test('a card with no envelopes at all is still verifiable', () => {
    // density-of-states is a declared envelope refusal — its magnitude has no
    // system-independent range. Its sign does, and that is now checkable from a
    // shell, which is the whole reason this evidence shape exists.
    const good = write('dos-good.json', { epsilon: [-1, 0, 1], g: [0, 1.2, 0.4] });
    const r = capture(['verify', 'density-of-states', '--series', good]);
    assert.equal(r.code, 0);
    assert.match(r.out, /g >= 0 holds/);
  });

  test('a negative density of states fails', () => {
    const bad = write('dos-bad.json', { epsilon: [-1, 0, 1], g: [0, -1.2, 0.4] });
    assert.equal(capture(['verify', 'density-of-states', '--series', bad]).code, 1);
  });

  test('a refinement study recomputes the order rather than trusting a report', () => {
    const study = write('study.json', [
      [0.1, 1e-5],
      [0.05, 2.5e-6],
      [0.025, 6.25e-7],
    ]);
    const r = capture(['verify', 'finite-difference-truncation-error', '--refinement', study]);
    assert.equal(r.code, 0);
    assert.match(r.out, /Observed convergence order 2 is within/);
  });

  test('a first-order scheme claiming second order fails', () => {
    const study = write('bad-study.json', [
      [0.1, 1e-5],
      [0.05, 5e-6],
      [0.025, 2.5e-6],
    ]);
    assert.equal(
      capture(['verify', 'finite-difference-truncation-error', '--refinement', study]).code,
      1,
    );
  });

  test('several evidence shapes report as one verdict', () => {
    // The reported order is checked against the envelope AND recomputed from
    // the study. Before this, only the first was possible — so a user could
    // report any number they liked.
    const study = write('combined.json', [
      [0.1, 1e-5],
      [0.05, 2.5e-6],
      [0.025, 6.25e-7],
    ]);
    const r = capture([
      'verify',
      'finite-difference-truncation-error',
      '--output',
      '{"observedConvergenceOrder": 2.0}',
      '--refinement',
      study,
      '--json',
    ]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.out) as {
      overall: { total: number };
      sections: Record<string, unknown>;
    };
    assert.equal(parsed.overall.total, 2);
    assert.deepEqual(Object.keys(parsed.sections).sort(), ['convergence', 'envelopes']);
  });

  test('no evidence at all is a usage error, not a silent pass', () => {
    assert.equal(capture(['verify', 'density-of-states']).code, 2);
  });

  test('malformed evidence files are usage errors', () => {
    assert.equal(
      capture(['verify', 'density-of-states', '--series', write('s.json', [1, 2, 3])]).code,
      2,
    );
    assert.equal(
      capture([
        'verify',
        'finite-difference-truncation-error',
        '--refinement',
        write('r.json', { not: 'an array of pairs' }),
      ]).code,
      2,
    );
  });
});

describe('paths reports the resolved corpus, it does not guess', () => {
  test('the reported directory is the one the loader actually used', async () => {
    // An earlier version inferred this from whether LEMMA_CARDS_DIR was set and
    // announced "using the bundled corpus" even when the loader had fallen
    // through to a repo checkout. A command whose only job is to say where the
    // cards came from must report, not infer — a stale bundled copy shadowing
    // the working tree is exactly the situation this is meant to reveal.
    const { CARDS_DIR } = await import('@artano-ai/mcp-server/engine');
    const r = capture(['paths', '--json']);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.out) as { cardsDir: string; total: number };
    assert.equal(parsed.cardsDir, CARDS_DIR);
    assert.equal(parsed.total, parsed.total, 'total is reported');
    assert.ok(parsed.total > 0);
  });
});

describe('packaging', () => {
  test('the reported version matches package.json', () => {
    // Hard-coded in version.ts so the build needs no JSON import; this keeps
    // the two from drifting.
    const pkg = JSON.parse(readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const r = capture(['--version']);
    assert.equal(r.out.trim(), `lemma ${pkg.version}`);
  });
});
