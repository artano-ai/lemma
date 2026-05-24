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
