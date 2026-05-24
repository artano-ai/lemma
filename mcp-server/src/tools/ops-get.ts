import { OPS_CARDS, findOpsCard } from '../cards/seed.js';
import type { McpTool } from './types.js';

export const opsGetTool: McpTool = {
  name: 'ops_get',
  description:
    'Fetch a full Lemma ops card by id and render it as human-readable Markdown (parameters table, validation rules, references). Ops cards are parameterised templates for scripting / job-submission tasks (SLURM, Snakemake, Singularity). Use cards_list with domain="ops" to discover available ids. Use cards_get for the raw JSON record.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description:
          'Ops card id, e.g. "slurm-mn5-gpu", "snakemake-dft-workflow", "singularity-recipe".',
      },
    },
    required: ['id'],
  },
  async run(input) {
    const id = String(input.id ?? '').trim();
    if (!id) {
      throw new Error('Empty id.');
    }

    const ops = findOpsCard(id);
    if (!ops) {
      const knownOps = OPS_CARDS.map((c) => c.id).join(', ');
      throw new Error(
        `No ops card with id "${id}". Known ops-card ids: ${knownOps}.`,
      );
    }

    const lines: string[] = [];
    lines.push(`# ${ops.name}  \`${ops.id}\` v${ops.version}`);
    lines.push('');
    lines.push(ops.description);
    lines.push('');

    if (ops.parameters.length > 0) {
      lines.push('## Parameters');
      lines.push('');
      lines.push('| Key | Label | Default | Required | Note |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const p of ops.parameters) {
        const def = p.defaultValue === '' ? '_(none)_' : `\`${p.defaultValue}\``;
        const req = p.required ? 'yes' : 'no';
        const note = p.note ? p.note.replace(/\|/g, '\\|') : '';
        lines.push(`| \`${p.key}\` | ${p.label} | ${def} | ${req} | ${note} |`);
      }
      lines.push('');
    }

    if (ops.validation.length > 0) {
      lines.push('## Validation rules');
      lines.push('');
      for (const v of ops.validation) {
        lines.push(`- ${v}`);
      }
      lines.push('');
    }

    if (ops.references.length > 0) {
      lines.push('## References');
      lines.push('');
      for (const r of ops.references) {
        lines.push(`- ${r}`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  },
};
