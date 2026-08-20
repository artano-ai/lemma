#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma-rag` — build and inspect the index `rag_lookup` searches.
 *
 * Lives in `@artano-ai/mcp-server` rather than in `@artano-ai/cli` on purpose:
 * this needs `pg` and an embedding model, and the CLI is deliberately
 * dependency-free. A verification tool that drags a Postgres driver and a
 * 600MB ONNX model into a CI image is a harder sell than one that does not.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { disposePool, getPool, getRagSchema } from './rag/pool.js';
import { getEmbedder } from './rag/embed.js';
import { buildRagIndex, forgetSource, ingestFile, initRagStore } from './rag/ingest.js';

const HELP = `lemma-rag — build the index that rag_lookup searches

USAGE
  lemma-rag init                      create the schema, table and indexes
  lemma-rag ingest <path...>          chunk, embed and upsert files or directories
  lemma-rag status                    what is currently indexed
  lemma-rag forget <source>           remove everything under one source label

OPTIONS
  --ext <list>        extensions to pick up when given a directory
                      (default: .md,.txt,.rst)
  --source <label>    override the recorded source label (single file only)
  --chunk-chars <n>   target characters per passage (default 1200)
  --overlap <n>       characters repeated between passages (default 150)
  --no-index          skip rebuilding the ANN index after ingesting
  -h, --help

ENVIRONMENT
  LEMMA_RAG_DSN                Postgres connection string  (required)
  LEMMA_RAG_SCHEMA             schema name                 (default atomira_lab)
  LEMMA_EMBEDDING_PROVIDER     transformers | gemini       (default transformers)
  LEMMA_EMBEDDING_DIM          embedding width             (default 768)

This ingests files you point it at. Nothing is bundled — no corpus ships with
this package.
`;

async function collect(target: string, exts: string[]): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const out: string[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...(await collect(full, exts)));
    else if (exts.includes(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out.sort();
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      ext: { type: 'string' },
      source: { type: 'string' },
      'chunk-chars': { type: 'string' },
      overlap: { type: 'string' },
      'no-index': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }

  const [command, ...rest] = positionals;

  // Reject an unknown command *before* checking configuration. Otherwise a
  // typo is answered with "set LEMMA_RAG_DSN", sending someone to configure a
  // database for a command that does not exist.
  const COMMANDS = ['init', 'ingest', 'status', 'forget'];
  if (!COMMANDS.includes(command)) {
    process.stderr.write(
      `error unknown command "${command}". Expected one of: ${COMMANDS.join(', ')}. ` +
        'Run `lemma-rag --help`.\n',
    );
    return 2;
  }

  if (!process.env.LEMMA_RAG_DSN?.trim()) {
    process.stderr.write(
      'error LEMMA_RAG_DSN is not set. rag_lookup needs a Postgres database with pgvector;\n' +
        '      point this at it, e.g. postgres://user:pass@localhost:5432/lemma\n',
    );
    return 2;
  }

  switch (command) {
    case 'init': {
      const { schema, dim } = await initRagStore();
      process.stdout.write(`initialised "${schema}".chunks for ${dim}-dimensional vectors\n`);
      return 0;
    }

    case 'ingest': {
      if (rest.length === 0) {
        process.stderr.write('error ingest needs at least one file or directory\n');
        return 2;
      }
      const exts = (values.ext ?? '.md,.txt,.rst')
        .split(',')
        .map((e) => (e.startsWith('.') ? e : `.${e}`).trim().toLowerCase());

      const { schema, dim } = await initRagStore();
      process.stdout.write(`schema "${schema}" ready (${dim}-dimensional)\n`);

      const files: string[] = [];
      for (const target of rest) files.push(...(await collect(target, exts)));
      if (files.length === 0) {
        process.stderr.write(`error no files matching ${exts.join(', ')} under ${rest.join(', ')}\n`);
        return 2;
      }
      if (values.source && files.length > 1) {
        process.stderr.write(
          `error --source labels a single document, but ${files.length} files matched. ` +
            `Sharing one label across files would make every hit cite the same origin.\n`,
        );
        return 2;
      }

      let chunks = 0;
      let inserted = 0;
      let updated = 0;
      for (const file of files) {
        const result = await ingestFile(file, {
          source: values.source,
          targetChars: values['chunk-chars'] ? Number(values['chunk-chars']) : undefined,
          overlapChars: values.overlap ? Number(values.overlap) : undefined,
        });
        chunks += result.chunks;
        inserted += result.inserted;
        updated += result.updated;
        process.stdout.write(
          `  ${path.relative(process.cwd(), file)} — ${result.chunks} passages ` +
            `(${result.inserted} new, ${result.updated} updated)\n`,
        );
      }

      if (!values['no-index']) {
        // After the load, never before: ivfflat clusters the rows it can see.
        await buildRagIndex();
        process.stdout.write('ANN index built\n');
      }
      process.stdout.write(
        `\n${files.length} file(s) · ${chunks} passages · ${inserted} new · ${updated} updated\n`,
      );
      return 0;
    }

    case 'status': {
      const pool = getPool()!;
      const schema = getRagSchema();
      const embedder = await getEmbedder();
      const exists = await pool.query<{ ok: boolean }>(
        `SELECT to_regclass($1) IS NOT NULL AS ok`,
        [`"${schema}".chunks`],
      );
      if (!exists.rows[0]?.ok) {
        process.stdout.write(`schema "${schema}": no chunks table yet — run \`lemma-rag init\`\n`);
        return 0;
      }
      const rows = await pool.query<{ source: string; n: string }>(
        `SELECT source, count(*)::text AS n FROM "${schema}".chunks GROUP BY source ORDER BY source`,
      );
      const total = rows.rows.reduce((acc, r) => acc + Number(r.n), 0);
      process.stdout.write(
        `schema "${schema}" · ${total} passages from ${rows.rowCount} source(s) · ` +
          `embedder ${embedder.provider} (${embedder.dim}d)\n`,
      );
      for (const row of rows.rows) process.stdout.write(`  ${row.n.padStart(6)}  ${row.source}\n`);
      return 0;
    }

    case 'forget': {
      const source = rest[0];
      if (!source) {
        process.stderr.write('error forget needs a source label (see `lemma-rag status`)\n');
        return 2;
      }
      const removed = await forgetSource(source);
      process.stdout.write(`removed ${removed} passage(s) from ${source}\n`);
      return 0;
    }

    /* c8 ignore next 3 -- unreachable: COMMANDS is validated above */
    default:
      process.stderr.write(`error unknown command "${command}". Run \`lemma-rag --help\`.\n`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`error ${(err as Error).message}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void disposePool();
  });
