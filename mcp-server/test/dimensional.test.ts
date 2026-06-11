import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveDims,
  DimDerivationError,
  dimsEqual,
} from '../src/cards/dimensional.js';
import { runHypothesisChecks } from '../src/cards/checks.js';

test('propagator: kinetic energy', () => {
  assert.ok(
    dimsEqual(deriveDims('(1/2)*m*v**2', { m: { M: 1 }, v: { L: 1, T: -1 } }), {
      M: 1,
      L: 2,
      T: -2,
    }),
  );
});

test('propagator: product / division / power / unary / number', () => {
  assert.ok(dimsEqual(deriveDims('m*v', { m: { M: 1 }, v: { L: 1, T: -1 } }), { M: 1, L: 1, T: -1 }));
  assert.ok(dimsEqual(deriveDims('a/b', { a: { L: 1 }, b: { T: 1 } }), { L: 1, T: -1 }));
  assert.ok(dimsEqual(deriveDims('x**3', { x: { L: 1 } }), { L: 3 }));
  assert.ok(dimsEqual(deriveDims('-x', { x: { M: 1 } }), { M: 1 }));
  assert.ok(dimsEqual(deriveDims('2*x', { x: { M: 1 } }), { M: 1 }));
});

test('addition requires equal dims', () => {
  assert.ok(dimsEqual(deriveDims('a+b', { a: { L: 1 }, b: { L: 1 } }), { L: 1 }));
  assert.throws(() => deriveDims('a+b', { a: { L: 1 }, b: { T: 1 } }), DimDerivationError);
});

test('unsupported expressions throw DimDerivationError', () => {
  assert.throws(() => deriveDims('S**(1/4)', { S: { M: 1 } }), DimDerivationError);
  assert.throws(() => deriveDims('a*b', { a: { M: 1 } }), DimDerivationError);
  assert.throws(() => deriveDims('sqrt(x)', { x: { L: 2 } }), DimDerivationError);
});

function dimCheck(dimensional: unknown) {
  const card = {
    kind: 'hypothesis',
    id: 't',
    version: '0.1.0',
    name: 't',
    proposal: 'p',
    proposedFormulaTeX: 'f',
    origin: 'llm',
    references: ['x'],
    checks: { dimensional },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return runHypothesisChecks(card, { corpus: [] }).checks.find(
    (c) => c.name === 'Hypothesis.dimensional_analysis',
  )!;
}

test('engine derives a pass from the formula', () => {
  const c = dimCheck({
    lhsLabel: 'E', lhsDims: { M: 1, L: 2, T: -2 },
    rhsLabel: '½mv²', rhsDims: { M: 1, L: 2, T: -2 },
    expr: '(1/2)*m*v**2', symbols: { m: { M: 1 }, v: { L: 1, T: -1 } },
  });
  assert.equal(c.severity, 'pass');
});

test('engine catches a declared-but-wrong formula', () => {
  const c = dimCheck({
    lhsLabel: 'E', lhsDims: { M: 1, L: 2, T: -2 },
    rhsLabel: 'm v', rhsDims: { M: 1, L: 2, T: -2 },
    expr: 'm*v', symbols: { m: { M: 1 }, v: { L: 1, T: -1 } },
  });
  assert.equal(c.severity, 'fail');
});

test('engine falls back when the formula is not derivable', () => {
  const c = dimCheck({
    lhsLabel: 'T', lhsDims: { Theta: 1 },
    rhsLabel: '(S)^¼', rhsDims: { Theta: 1 },
    expr: 'S**(1/4)', symbols: { S: { Theta: 4 } },
  });
  assert.equal(c.severity, 'pass');
});
