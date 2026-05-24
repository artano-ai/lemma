import { readWorkspaceText } from '../workspace.js';
import type { McpTool } from './types.js';

interface EigData {
  fermiEv: number;
  nBands: number;
  nSpin: number;
  nKpts: number;
  // eigenvalues[kpt][spin][band] in eV
  eigenvalues: number[][][];
}

function parseEig(text: string): EigData {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 4) throw new Error('Empty or malformed .EIG file');

  let p = 0;
  const fermiEv = Number(tokens[p++]);
  const nBands = Number(tokens[p++]);
  const nSpin = Number(tokens[p++]);
  const nKpts = Number(tokens[p++]);

  if (!Number.isFinite(fermiEv) || !Number.isInteger(nBands) || !Number.isInteger(nSpin) || !Number.isInteger(nKpts)) {
    throw new Error(
      `Bad header: fermi=${fermiEv} nBands=${nBands} nSpin=${nSpin} nKpts=${nKpts}`,
    );
  }

  const eigenvalues: number[][][] = [];
  for (let k = 0; k < nKpts; k++) {
    // First number on each k-block is the k-point index
    p++;
    const perKpt: number[][] = [];
    for (let s = 0; s < nSpin; s++) {
      const bands: number[] = [];
      for (let b = 0; b < nBands; b++) {
        if (p >= tokens.length) {
          throw new Error(
            `Ran out of data at kpt=${k + 1}/${nKpts} spin=${s + 1}/${nSpin} band=${b + 1}/${nBands}`,
          );
        }
        bands.push(Number(tokens[p++]));
      }
      perKpt.push(bands);
    }
    eigenvalues.push(perKpt);
  }

  return { fermiEv, nBands, nSpin, nKpts, eigenvalues };
}

interface BandStats {
  spin: number;
  vbm: number;
  cbm: number;
  vbmKpt: number;
  cbmKpt: number;
  gapEv: number;
  isMetallic: boolean;
}

function bandStats(data: EigData): BandStats[] {
  const stats: BandStats[] = [];
  const TOL = 1e-6;
  for (let s = 0; s < data.nSpin; s++) {
    let vbm = -Infinity;
    let cbm = Infinity;
    let vbmKpt = -1;
    let cbmKpt = -1;
    let isMetallic = false;
    for (let k = 0; k < data.nKpts; k++) {
      for (const e of data.eigenvalues[k][s]) {
        if (e <= data.fermiEv + TOL && e > vbm) {
          vbm = e;
          vbmKpt = k + 1;
        }
        if (e > data.fermiEv + TOL && e < cbm) {
          cbm = e;
          cbmKpt = k + 1;
        }
      }
      const bands = data.eigenvalues[k][s];
      const below = bands.some((e) => e < data.fermiEv - TOL);
      const above = bands.some((e) => e > data.fermiEv + TOL);
      if (below && above && vbm > cbm) isMetallic = true;
    }
    const gapEv = isMetallic ? 0 : Math.max(0, cbm - vbm);
    stats.push({ spin: s + 1, vbm, cbm, vbmKpt, cbmKpt, gapEv, isMetallic });
  }
  return stats;
}

function summarize(path: string, data: EigData): string {
  const stats = bandStats(data);
  const lines: string[] = [];
  lines.push(`# EIG summary: ${path}`);
  lines.push('');
  lines.push(`Fermi level: ${data.fermiEv.toFixed(4)} eV`);
  lines.push(`Bands: ${data.nBands}`);
  lines.push(`Spins: ${data.nSpin}`);
  lines.push(`k-points: ${data.nKpts}`);
  lines.push('');
  lines.push('## Per-spin band edges (relative to absolute eV scale)');
  for (const s of stats) {
    if (s.isMetallic) {
      lines.push(
        `- spin ${s.spin}: METALLIC (bands cross Fermi). VBM=${s.vbm.toFixed(4)} eV @ k=${s.vbmKpt}, CBM=${s.cbm.toFixed(4)} eV @ k=${s.cbmKpt}`,
      );
    } else {
      lines.push(
        `- spin ${s.spin}: gap=${s.gapEv.toFixed(4)} eV  (VBM=${s.vbm.toFixed(4)} @ k=${s.vbmKpt}, CBM=${s.cbm.toFixed(4)} @ k=${s.cbmKpt})`,
      );
    }
  }
  return lines.join('\n');
}

function dumpKpoint(data: EigData, k: number): string {
  if (k < 1 || k > data.nKpts) {
    throw new Error(`kpt out of range: ${k} (have ${data.nKpts})`);
  }
  const lines: string[] = [];
  lines.push(`# k-point ${k} eigenvalues (eV), Fermi=${data.fermiEv.toFixed(4)}`);
  for (let s = 0; s < data.nSpin; s++) {
    lines.push(`## spin ${s + 1}`);
    const bands = data.eigenvalues[k - 1][s];
    for (let b = 0; b < bands.length; b++) {
      const e = bands[b];
      const rel = (e - data.fermiEv).toFixed(4);
      const tag = e <= data.fermiEv ? 'occ' : 'unocc';
      lines.push(`  band ${b + 1}: ${e.toFixed(4)} (E-Ef=${rel}, ${tag})`);
    }
  }
  return lines.join('\n');
}

export const parseEigFileTool: McpTool = {
  name: 'parse_eig_file',
  description:
    "Parse a Siesta .EIG file (eigenvalues per k-point, per spin). Returns Fermi level, band counts and a band-edge summary including bandgap, VBM/CBM, and a metallic check. Pass kpt=N to dump one k-point's eigenvalues.",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative path to the .EIG file.',
      },
      kpt: {
        type: 'number',
        description: '1-based k-point index. If set, dump that k-point only.',
      },
    },
    required: ['path'],
  },
  async run(input) {
    const path = String(input.path ?? '');
    if (!path) throw new Error('path is required');

    const text = await readWorkspaceText(path, 20_000_000);
    const data = parseEig(text);

    if (typeof input.kpt === 'number') {
      return dumpKpoint(data, Math.round(input.kpt));
    }
    return summarize(path, data);
  },
};
