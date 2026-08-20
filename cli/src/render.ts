// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Output rendering — human-readable by default, `--json` for machines.
 *
 * ## Colour
 *
 * ANSI codes are written directly rather than pulled from a dependency, and
 * they are suppressed unless stdout is a TTY. `NO_COLOR` (any value) and
 * `--no-color` also disable them. A CLI whose output is usually piped into a
 * log should not emit escape sequences by default.
 *
 * ## The prose is not ours to reword
 *
 * Check details come from the engine verbatim. The Python and TypeScript
 * engines are contracted to return byte-identical verdicts *and* byte-identical
 * prose, and a fixture in `lemma/parity/` enforces it. If this layer
 * paraphrased a detail string, the two runtimes would report the same finding
 * in different words and the contract would be broken at the surface a user
 * actually reads. Render around the text; never rewrite it.
 */

export type Severity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

let colorEnabled = false;

export function configureColor(force: boolean | undefined): void {
  if (force === false) {
    colorEnabled = false;
    return;
  }
  if (process.env.NO_COLOR !== undefined) {
    colorEnabled = false;
    return;
  }
  colorEnabled = force === true || Boolean(process.stdout.isTTY);
}

function wrap(code: string, text: string): string {
  return colorEnabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const bold = (t: string) => wrap('1', t);
export const dim = (t: string) => wrap('2', t);
export const cyan = (t: string) => wrap('36', t);
export const green = (t: string) => wrap('32', t);
export const yellow = (t: string) => wrap('33', t);
export const red = (t: string) => wrap('31', t);
export const magenta = (t: string) => wrap('35', t);

/** Per-check severity — `pass` / `warn` / `fail`, not the overall scale. */
export function checkMark(severity: string): string {
  if (severity === 'pass') return green('  pass');
  if (severity === 'fail') return red('  fail');
  return yellow('  warn');
}

export function severityColor(severity: Severity, text: string): string {
  if (severity === 'NONE') return green(text);
  if (severity === 'HIGH') return red(text);
  if (severity === 'MEDIUM') return yellow(text);
  return yellow(text);
}

/**
 * Left-pad a column to a fixed width, measured on the *uncoloured* string —
 * ANSI escapes have no display width, so padding on the raw length would
 * misalign every coloured cell.
 */
export function pad(text: string, width: number): string {
  const visible = text.replace(/\u001b\[[0-9;]*m/g, '');
  return text + ' '.repeat(Math.max(0, width - visible.length));
}

export function table(rows: string[][], headers: string[]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').replace(/\u001b\[[0-9;]*m/g, '').length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => pad(c, widths[i]!)).join('  ').trimEnd();
  const out = [dim(line(headers.map(bold)))];
  for (const row of rows) out.push(line(row));
  return out.join('\n');
}

export function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
