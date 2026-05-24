import { readWorkspaceText } from '../workspace.js';
import type { McpTool } from './types.js';

interface FdfScalar {
  label: string;
  value: string;
  unit?: string;
}

interface FdfBlock {
  label: string;
  lines: string[];
}

interface FdfParseResult {
  path: string;
  scalars: FdfScalar[];
  blocks: FdfBlock[];
  warnings: string[];
}

const COMMENT_RE = /[#;!].*$/;

function normalizeLabel(raw: string): string {
  return raw.toLowerCase().replace(/[-_.]/g, '');
}

function stripComment(line: string): string {
  return line.replace(COMMENT_RE, '').trimEnd();
}

function parseFdf(text: string): { scalars: FdfScalar[]; blocks: FdfBlock[]; warnings: string[] } {
  const lines = text.split(/\r?\n/);
  const scalars: FdfScalar[] = [];
  const blocks: FdfBlock[] = [];
  const warnings: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const raw = stripComment(lines[i]).trim();
    i++;
    if (!raw) continue;

    if (/^%block\b/i.test(raw)) {
      const label = raw.replace(/^%block\b\s*/i, '').trim();
      const blockLines: string[] = [];
      let closed = false;
      while (i < lines.length) {
        const inner = stripComment(lines[i]);
        i++;
        if (/^\s*%endblock\b/i.test(inner)) {
          closed = true;
          break;
        }
        if (inner.trim()) blockLines.push(inner.trim());
      }
      if (!closed) warnings.push(`Unterminated %block ${label}`);
      blocks.push({ label, lines: blockLines });
      continue;
    }

    if (/^%endblock\b/i.test(raw)) {
      warnings.push(`Stray %endblock at line ${i}`);
      continue;
    }

    const tokens = raw.split(/\s+/);
    if (tokens.length < 2) {
      warnings.push(`Skipping malformed line: "${raw}"`);
      continue;
    }
    const [label, value, unit] = tokens;
    scalars.push({ label, value, unit });
  }

  return { scalars, blocks, warnings };
}

function findScalar(scalars: FdfScalar[], label: string): FdfScalar | undefined {
  const target = normalizeLabel(label);
  return scalars.find((s) => normalizeLabel(s.label) === target);
}

function findBlock(blocks: FdfBlock[], label: string): FdfBlock | undefined {
  const target = normalizeLabel(label);
  return blocks.find((b) => normalizeLabel(b.label) === target);
}

function summarize(result: FdfParseResult): string {
  const lines: string[] = [];
  lines.push(`# FDF summary: ${result.path}`);
  lines.push('');
  lines.push(`Scalars: ${result.scalars.length}, blocks: ${result.blocks.length}`);

  const highlights = [
    'SystemName',
    'SystemLabel',
    'NumberOfAtoms',
    'NumberOfSpecies',
    'LatticeConstant',
    'XC.functional',
    'XC.authors',
    'PAO.BasisSize',
    'MeshCutoff',
    'MaxSCFIterations',
    'DM.Tolerance',
    'DM.MixingWeight',
    'ElectronicTemperature',
    'OccupationFunction',
    'kgrid_Monkhorst_Pack',
    'SolutionMethod',
    'MD.TypeOfRun',
    'MD.NumCGSteps',
  ];

  lines.push('');
  lines.push('## Key scalars');
  for (const key of highlights) {
    const s = findScalar(result.scalars, key);
    if (s) {
      lines.push(`- ${key}: ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
    }
  }

  if (result.blocks.length > 0) {
    lines.push('');
    lines.push('## Blocks');
    for (const b of result.blocks) {
      lines.push(`- %block ${b.label} (${b.lines.length} rows)`);
    }
  }

  if (result.warnings.length > 0) {
    lines.push('');
    lines.push('## Warnings');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  return lines.join('\n');
}

export const parseSiestaFdfTool: McpTool = {
  name: 'parse_siesta_fdf',
  description:
    "Parse a Siesta .fdf input file. Returns labelled scalars and %block ... %endblock sections. Use mode='summary' for key parameters, 'full' for everything, or pass label/block to fetch one entry. Label matching is case-insensitive and ignores - _ . separators (Siesta convention).",
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative path to the .fdf file.',
      },
      mode: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'Output mode. Default "summary".',
      },
      label: {
        type: 'string',
        description: 'Return only this scalar label (e.g. "MeshCutoff").',
      },
      block: {
        type: 'string',
        description: 'Return only this block label (e.g. "ChemicalSpeciesLabel").',
      },
    },
    required: ['path'],
  },
  async run(input) {
    const path = String(input.path ?? '');
    if (!path) throw new Error('path is required');

    const text = await readWorkspaceText(path);
    const parsed = parseFdf(text);
    const result: FdfParseResult = { path, ...parsed };

    if (typeof input.label === 'string' && input.label) {
      const s = findScalar(parsed.scalars, input.label);
      if (!s) throw new Error(`Label not found: ${input.label}`);
      return `${s.label} ${s.value}${s.unit ? ` ${s.unit}` : ''}`;
    }

    if (typeof input.block === 'string' && input.block) {
      const b = findBlock(parsed.blocks, input.block);
      if (!b) throw new Error(`Block not found: ${input.block}`);
      return `%block ${b.label}\n${b.lines.join('\n')}\n%endblock ${b.label}`;
    }

    const mode = input.mode === 'full' ? 'full' : 'summary';
    if (mode === 'full') {
      const lines: string[] = [];
      lines.push(`# FDF dump: ${path}`);
      lines.push('');
      lines.push('## Scalars');
      for (const s of parsed.scalars) {
        lines.push(`${s.label} ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
      }
      for (const b of parsed.blocks) {
        lines.push('');
        lines.push(`%block ${b.label}`);
        for (const l of b.lines) lines.push(l);
        lines.push(`%endblock ${b.label}`);
      }
      if (parsed.warnings.length > 0) {
        lines.push('');
        lines.push('## Warnings');
        for (const w of parsed.warnings) lines.push(`- ${w}`);
      }
      return lines.join('\n');
    }

    return summarize(result);
  },
};
