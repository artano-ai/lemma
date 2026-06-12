// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Tiny dimensional algebra. Cards declare both sides of their proposed
 * equation as DimVec (integer exponents on the seven primitive axes), and
 * the engine compares canonical forms — no unit-string parser, no LaTeX
 * traversal. Cards must declare in canonical form directly.
 */
import type { DimVec } from './types.js';

const AXES = ['L', 'T', 'M', 'E', 'Q', 'Theta', 'N'] as const;
type Axis = (typeof AXES)[number];

const AXIS_LABEL: Record<Axis, string> = {
  L: 'L',
  T: 'T',
  M: 'M',
  E: 'E',
  Q: 'Q',
  Theta: 'Θ',
  N: 'N',
};

function get(v: DimVec, axis: Axis): number {
  const x = (v as Record<string, number | undefined>)[axis];
  return x ?? 0;
}

export function dimsEqual(a: DimVec, b: DimVec): boolean {
  for (const axis of AXES) {
    if (get(a, axis) !== get(b, axis)) return false;
  }
  return true;
}

/** Render a DimVec as `L^-3·E^-1·N` (or `dimensionless`). */
export function stringifyDims(v: DimVec): string {
  const parts: string[] = [];
  for (const axis of AXES) {
    const exp = get(v, axis);
    if (exp === 0) continue;
    parts.push(exp === 1 ? AXIS_LABEL[axis] : `${AXIS_LABEL[axis]}^${exp}`);
  }
  return parts.length === 0 ? 'dimensionless' : parts.join('·');
}

export class DimDerivationError extends Error {}

type Dims = Record<Axis, number>;

function zeroDims(): Dims {
  return { L: 0, T: 0, M: 0, E: 0, Q: 0, Theta: 0, N: 0 };
}
function canon(v: DimVec): Dims {
  const d = zeroDims();
  for (const axis of AXES) d[axis] = get(v, axis);
  return d;
}
function combine(a: Dims, b: Dims, sign: number): Dims {
  const d = zeroDims();
  for (const axis of AXES) d[axis] = a[axis] + sign * b[axis];
  return d;
}
function scaleDims(a: Dims, n: number): Dims {
  const d = zeroDims();
  for (const axis of AXES) d[axis] = a[axis] * n;
  return d;
}
function dimsEqualRaw(a: Dims, b: Dims): boolean {
  for (const axis of AXES) if (a[axis] !== b[axis]) return false;
  return true;
}

interface Tok {
  kind: 'num' | 'id' | 'op' | 'lparen' | 'rparen';
  value: string;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(') { toks.push({ kind: 'lparen', value: ch }); i++; continue; }
    if (ch === ')') { toks.push({ kind: 'rparen', value: ch }); i++; continue; }
    if (ch === '*' && src[i + 1] === '*') { toks.push({ kind: 'op', value: '**' }); i += 2; continue; }
    if (ch === '*' || ch === '/' || ch === '+' || ch === '-') { toks.push({ kind: 'op', value: ch }); i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      toks.push({ kind: 'num', value: src.slice(i, j) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      toks.push({ kind: 'id', value: src.slice(i, j) }); i = j; continue;
    }
    throw new DimDerivationError(`unexpected character '${ch}'`);
  }
  return toks;
}

/**
 * Derive a DimVec from an ASCII expression + per-symbol dims. Recursive-
 * descent, no eval. Supports `+ - * /`, integer `**`, parentheses, unary
 * signs, and numeric literals (dimensionless). Throws DimDerivationError on
 * anything non-derivable (function calls, fractional/symbolic powers,
 * undeclared symbols) so the caller can fall back rather than guess.
 */
export function deriveDims(expr: string, symbols: Record<string, DimVec>): DimVec {
  const table: Record<string, Dims> = {};
  for (const [name, dv] of Object.entries(symbols)) table[name] = canon(dv);
  const toks = tokenize(expr);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];

  function parseExpr(): Dims {
    const left = parseTerm();
    let acc = left;
    while (peek()?.kind === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      pos++;
      const right = parseTerm();
      if (!dimsEqualRaw(acc, right)) {
        throw new DimDerivationError(
          `added terms differ dimensionally: ${stringifyDims(acc)} vs ${stringifyDims(right)}`,
        );
      }
    }
    return acc;
  }
  function parseTerm(): Dims {
    let left = parseUnary();
    while (peek()?.kind === 'op' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = toks[pos++]!.value;
      const right = parseUnary();
      left = combine(left, right, op === '*' ? 1 : -1);
    }
    return left;
  }
  function parseUnary(): Dims {
    if (peek()?.kind === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      pos++;
      return parseUnary();
    }
    return parsePower();
  }
  function parsePower(): Dims {
    const base = parseAtom();
    if (peek()?.kind === 'op' && peek()!.value === '**') {
      pos++;
      return scaleDims(base, parseIntExponent());
    }
    return base;
  }
  function parseIntExponent(): number {
    let sign = 1;
    while (peek()?.kind === 'op' && (peek()!.value === '+' || peek()!.value === '-')) {
      if (toks[pos++]!.value === '-') sign = -sign;
    }
    const t = peek();
    if (!t || t.kind !== 'num' || !/^\d+$/.test(t.value)) {
      throw new DimDerivationError('exponent is not an integer literal');
    }
    pos++;
    return sign * parseInt(t.value, 10);
  }
  function parseAtom(): Dims {
    const t = peek();
    if (!t) throw new DimDerivationError('unexpected end of expression');
    if (t.kind === 'num') { pos++; return zeroDims(); }
    if (t.kind === 'id') {
      pos++;
      if (!(t.value in table)) throw new DimDerivationError(`undeclared symbol '${t.value}'`);
      return { ...table[t.value]! };
    }
    if (t.kind === 'lparen') {
      pos++;
      const inner = parseExpr();
      if (peek()?.kind !== 'rparen') throw new DimDerivationError('missing )');
      pos++;
      return inner;
    }
    throw new DimDerivationError(`unexpected token '${t.value}'`);
  }

  const result = parseExpr();
  if (pos !== toks.length) {
    throw new DimDerivationError(`unexpected token '${peek()?.value}'`);
  }
  return result;
}
