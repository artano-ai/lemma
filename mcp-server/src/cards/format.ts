// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Number rendering shared by every engine that puts a value into a verdict
 * string.
 *
 * This exists for cross-language parity, not for aesthetics. The engine ships
 * twice — TypeScript here, Python in `sdk-py/artano_lemma/engine.py` — and the
 * two are contracted to emit byte-identical prose so a consumer diffing
 * verdicts across implementations sees zero noise. Naive interpolation breaks
 * that contract on whole numbers: JavaScript renders `99.0` as `99` while
 * Python renders it as `99.0`, so an envelope declared `[0.0, 2.0]` (which the
 * real corpus contains) produced `[0, 2]` on one side and `[0.0, 2.0]` on the
 * other.
 *
 * `%g` is the fixed point: both languages implement it identically, including
 * the 6-significant-digit truncation. Matching JavaScript's *native* rendering
 * instead would not work — it keeps up to 17 significant digits, so `1/3`
 * would render `0.3333333333333333` here and `0.333333` in Python.
 */

/** Format a number the way `%g` does: `precision` significant digits, trailing
 *  zeros stripped, exponential form outside [1e-5, 10^precision). Keeps the
 *  detail strings readable for values that span many orders of magnitude. */
export function formatG(value: number, precision = 6): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(precision));
  const exponent = Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent < -4 || exponent >= precision) {
    const [mantissa, exp] = value.toExponential(precision - 1).split('e') as [string, string];
    const trimmed = mantissa.includes('.')
      ? mantissa.replace(/0+$/, '').replace(/\.$/, '')
      : mantissa;
    const sign = exp.startsWith('-') ? '-' : '+';
    return `${trimmed}e${sign}${exp.replace(/[+-]/, '').padStart(2, '0')}`;
  }
  const fixed = value.toFixed(Math.max(0, precision - 1 - exponent));
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}
