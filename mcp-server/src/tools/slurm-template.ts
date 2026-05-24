import type { McpTool } from './types.js';

interface SlurmInput {
  jobName: string;
  partition: string;
  nodes: number;
  tasksPerNode: number;
  cpusPerTask: number;
  gpusPerNode?: number;
  timeLimit: string; // HH:MM:SS
  qos?: string;
  account?: string;
  modules?: string[];
  command: string;
  outputFile?: string;
  errorFile?: string;
  email?: string;
  exclusive?: boolean;
  memPerCpu?: string; // e.g. "2G"
}

const KNOWN_PARTITIONS = new Set([
  'gpp_compute',
  'gpp_debug',
  'gpp_bsccs',
  'acc_compute',
  'acc_debug',
  'acc_bsccs',
]);

function validateTime(t: string): void {
  if (!/^\d{1,3}:\d{2}:\d{2}$/.test(t) && !/^\d+-\d{1,2}:\d{2}:\d{2}$/.test(t)) {
    throw new Error(
      `time must be HH:MM:SS or D-HH:MM:SS (got "${t}").`,
    );
  }
}

function buildScript(o: SlurmInput): string {
  validateTime(o.timeLimit);
  const lines: string[] = [];
  lines.push('#!/bin/bash');
  lines.push(`#SBATCH --job-name=${o.jobName}`);
  if (o.account) lines.push(`#SBATCH --account=${o.account}`);
  if (o.qos) lines.push(`#SBATCH --qos=${o.qos}`);
  lines.push(`#SBATCH --partition=${o.partition}`);
  lines.push(`#SBATCH --nodes=${o.nodes}`);
  lines.push(`#SBATCH --ntasks-per-node=${o.tasksPerNode}`);
  lines.push(`#SBATCH --cpus-per-task=${o.cpusPerTask}`);
  if (o.gpusPerNode && o.gpusPerNode > 0) {
    lines.push(`#SBATCH --gres=gpu:${o.gpusPerNode}`);
  }
  if (o.memPerCpu) lines.push(`#SBATCH --mem-per-cpu=${o.memPerCpu}`);
  if (o.exclusive) lines.push(`#SBATCH --exclusive`);
  lines.push(`#SBATCH --time=${o.timeLimit}`);
  lines.push(`#SBATCH --output=${o.outputFile ?? `${o.jobName}-%j.out`}`);
  lines.push(`#SBATCH --error=${o.errorFile ?? `${o.jobName}-%j.err`}`);
  if (o.email) {
    lines.push(`#SBATCH --mail-type=END,FAIL`);
    lines.push(`#SBATCH --mail-user=${o.email}`);
  }
  lines.push('');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push('module purge');
  if (o.modules && o.modules.length > 0) {
    for (const m of o.modules) lines.push(`module load ${m}`);
  }
  lines.push('');
  lines.push(`export OMP_NUM_THREADS=${o.cpusPerTask}`);
  lines.push('export OMP_PROC_BIND=close');
  lines.push('export OMP_PLACES=cores');
  lines.push('');
  lines.push('echo "Job: $SLURM_JOB_ID on $SLURM_JOB_NODELIST"');
  lines.push('echo "Started: $(date -Iseconds)"');
  lines.push('');
  const totalTasks = o.nodes * o.tasksPerNode;
  if (totalTasks > 1 || o.cpusPerTask > 1) {
    lines.push(`srun --cpu-bind=cores ${o.command}`);
  } else {
    lines.push(o.command);
  }
  lines.push('');
  lines.push('echo "Finished: $(date -Iseconds)"');
  return lines.join('\n');
}

export const generateSlurmTool: McpTool = {
  name: 'generate_slurm',
  description:
    'Generate a SLURM batch script. Defaults are tuned for MareNostrum 5 (BSC) but the directives are valid on any SLURM cluster. The script ends with srun + the user-supplied command, with OMP_NUM_THREADS=cpusPerTask wired in. Returns the script as text.',
  inputSchema: {
    type: 'object',
    properties: {
      jobName: { type: 'string' },
      partition: {
        type: 'string',
        description:
          'Slurm partition. MareNostrum 5: gpp_compute (CPU), acc_compute (GPU), *_debug for short interactive runs, *_bsccs for BSC-CCS reservations.',
      },
      nodes: { type: 'number', description: 'Number of nodes.' },
      tasksPerNode: {
        type: 'number',
        description: 'MPI tasks per node. MN5 GPP has 112 cores/node.',
      },
      cpusPerTask: {
        type: 'number',
        description:
          'OpenMP threads per MPI task. nodes * tasksPerNode * cpusPerTask should equal total cores.',
      },
      gpusPerNode: {
        type: 'number',
        description: 'GPUs per node (acc_compute partition only). MN5 ACC has 4 H100 / node.',
      },
      timeLimit: {
        type: 'string',
        description: 'HH:MM:SS or D-HH:MM:SS. e.g. "02:00:00" or "1-12:00:00".',
      },
      qos: { type: 'string', description: 'QOS, e.g. gp_bscls, gp_debug, acc_bscls.' },
      account: { type: 'string', description: 'Charge account / project code.' },
      modules: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Modules to load, in order. e.g. ["intel", "impi", "mkl", "siesta/4.1.5"].',
      },
      command: {
        type: 'string',
        description: 'The command to run, e.g. "siesta < input.fdf > output.out".',
      },
      outputFile: { type: 'string', description: 'Defaults to <jobName>-%j.out.' },
      errorFile: { type: 'string', description: 'Defaults to <jobName>-%j.err.' },
      email: { type: 'string', description: 'Mail address for END/FAIL notifications.' },
      exclusive: { type: 'boolean', description: 'Reserve nodes exclusively (--exclusive).' },
      memPerCpu: {
        type: 'string',
        description: 'Memory per CPU, e.g. "2G". Omit on MN5 (uses default DefMemPerCPU).',
      },
    },
    required: [
      'jobName',
      'partition',
      'nodes',
      'tasksPerNode',
      'cpusPerTask',
      'timeLimit',
      'command',
    ],
  },
  async run(input) {
    const required: (keyof SlurmInput)[] = [
      'jobName',
      'partition',
      'nodes',
      'tasksPerNode',
      'cpusPerTask',
      'timeLimit',
      'command',
    ];
    for (const k of required) {
      const v = input[k];
      if (v === undefined || v === null || v === '') {
        throw new Error(`Missing required field: ${k}`);
      }
    }

    const o: SlurmInput = {
      jobName: String(input.jobName),
      partition: String(input.partition),
      nodes: Number(input.nodes),
      tasksPerNode: Number(input.tasksPerNode),
      cpusPerTask: Number(input.cpusPerTask),
      timeLimit: String(input.timeLimit),
      command: String(input.command),
    };
    if (input.gpusPerNode !== undefined) o.gpusPerNode = Number(input.gpusPerNode);
    if (typeof input.qos === 'string') o.qos = input.qos;
    if (typeof input.account === 'string') o.account = input.account;
    if (Array.isArray(input.modules)) o.modules = input.modules.map(String);
    if (typeof input.outputFile === 'string') o.outputFile = input.outputFile;
    if (typeof input.errorFile === 'string') o.errorFile = input.errorFile;
    if (typeof input.email === 'string') o.email = input.email;
    if (typeof input.exclusive === 'boolean') o.exclusive = input.exclusive;
    if (typeof input.memPerCpu === 'string') o.memPerCpu = input.memPerCpu;

    const warnings: string[] = [];
    if (!KNOWN_PARTITIONS.has(o.partition)) {
      warnings.push(
        `Partition "${o.partition}" is not a known MareNostrum 5 partition. Known: ${[...KNOWN_PARTITIONS].join(', ')}.`,
      );
    }
    if (o.partition.startsWith('acc_') && !o.gpusPerNode) {
      warnings.push(
        'Partition starts with acc_ (GPU) but gpusPerNode was not set — typical MN5 ACC node has 4 H100s.',
      );
    }
    if (!o.partition.startsWith('acc_') && o.gpusPerNode) {
      warnings.push(
        `gpusPerNode=${o.gpusPerNode} requested but partition "${o.partition}" is not a GPU partition.`,
      );
    }

    const script = buildScript(o);

    if (warnings.length > 0) {
      return `# Warnings:\n${warnings.map((w) => `# - ${w}`).join('\n')}\n\n${script}`;
    }
    return script;
  },
};
