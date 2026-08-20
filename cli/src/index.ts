#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * `lemma` — the Lemma command line.
 *
 * Argument parsing uses `node:util`'s built-in `parseArgs`, so this package
 * ships with no runtime dependency other than the engine itself. That is a
 * deliberate match for the Python SDK, whose base install is kept light for the
 * same reason: a verification tool that drags a dependency tree into a CI image
 * is a harder sell than one that does not.
 *
 * ## Two runtimes, one binary name
 *
 * `artano-lemma` (PyPI) and `@artano-ai/cli` (npm) both install a `lemma`
 * command. That is intended — they are the same tool over the same corpus and
 * the same engine contract, and a user should install whichever runtime they
 * already have. Where the two overlap the commands are spelled the same, and
 * `lemma list` / `lemma show` work here as aliases of `lemma cards list` /
 * `lemma cards show` so that a habit learned against one runtime does not break
 * against the other.
 */

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { list, search, show } from './commands/cards.js';
import { crosscheck } from './commands/crosscheck.js';
import { verify } from './commands/verify.js';
import { paths } from './commands/paths.js';
import { CliError } from './errors.js';
import { bold, configureColor, cyan, dim, red } from './render.js';
import { VERSION } from './version.js';

const HELP = `${bold('lemma')} — open verification substrate for AI-generated scientific code

${bold('USAGE')}
  lemma <command> [options]

${bold('VERIFY')}
  ${cyan('verify')} <card-id> [evidence...]
      Check a finished run against what the card declares. Any combination of
      the three evidence shapes may be given; all are reported as one verdict.
      --output <json>        inline JSON object of key -> number (vs envelopes)
      --output-file <path>   read that JSON from a file, or '-' for stdin
      --series <path>        JSON of quantity -> samples (vs the card's
                             seriesConditions, e.g. a density of states must
                             never be negative)
      --refinement <path>    JSON array of [h, error] levels; recomputes the
                             observed convergence order from the study itself
                             rather than trusting a reported number
      --require-checks       treat "nothing was checked" as a failure

  ${cyan('crosscheck')} <card-id|file.json>
      Run the hypothesis cross-check engine over a corpus card or a draft.
      Pass '-' to read the draft from stdin.

${bold('BROWSE')}
  ${cyan('cards list')} [--kind <k>] [--domain <d>]     alias: lemma list
  ${cyan('cards show')} <card-id>                       alias: lemma show
  ${cyan('cards search')} <query>
  ${cyan('paths')}                                      where the corpus resolves from

${bold('GLOBAL')}
  --json           machine-readable output
  --no-color       disable ANSI colour (also honours NO_COLOR)
  -V, --version    print the version
  -h, --help       print this help

${bold('EXIT CODES')}
  0  everything passed
  1  the engine reported a HIGH severity
  2  the command could not run (bad id, unreadable input)

${dim('Corpus location is overridden with LEMMA_CARDS_DIR. Docs: https://openlemma.dev')}
`;

export function run(argv: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        output: { type: 'string' },
        'output-file': { type: 'string' },
        series: { type: 'string' },
        refinement: { type: 'string' },
        'require-checks': { type: 'boolean', default: false },
        kind: { type: 'string' },
        domain: { type: 'string' },
        json: { type: 'boolean', default: false },
        color: { type: 'boolean' },
        'no-color': { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'V', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    throw new CliError((err as Error).message);
  }

  const { values, positionals } = parsed;
  // `--json` implies no colour: the output is for a parser, and escape codes
  // would make it invalid to anything reading it as a stream of JSON.
  configureColor(values.json || values['no-color'] ? false : values.color);

  if (values.version) {
    process.stdout.write(`lemma ${VERSION}\n`);
    return 0;
  }
  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return positionals.length === 0 && !values.help ? 2 : 0;
  }

  const [command, ...rest] = positionals;
  const json = values.json;

  switch (command) {
    case 'verify': {
      const cardId = rest[0];
      if (!cardId) throw new CliError('verify needs a card id: lemma verify <card-id> --output \'{...}\'');
      return verify({
        cardId,
        output: values.output,
        outputFile: values['output-file'],
        seriesFile: values.series,
        refinementFile: values.refinement,
        requireChecks: values['require-checks'],
        json,
      });
    }
    case 'crosscheck': {
      const target = rest[0];
      if (!target) throw new CliError('crosscheck needs a card id or a file path.');
      return crosscheck({ target, json });
    }
    case 'cards': {
      const sub = rest[0];
      switch (sub) {
        case undefined:
        case 'list':
          return list({ kind: values.kind, domain: values.domain, json });
        case 'show': {
          const id = rest[1];
          if (!id) throw new CliError('cards show needs a card id.');
          return show(id, json);
        }
        case 'search': {
          const query = rest.slice(1).join(' ');
          if (!query) throw new CliError('cards search needs a query.');
          return search(query, json);
        }
        default:
          throw new CliError(`Unknown subcommand "cards ${sub}". Expected list, show, or search.`);
      }
    }
    // Aliases, so a habit learned against the Python CLI works here too.
    case 'list':
      return list({ kind: values.kind, domain: values.domain, json });
    case 'show': {
      const id = rest[0];
      if (!id) throw new CliError('show needs a card id.');
      return show(id, json);
    }
    case 'search': {
      const query = rest.join(' ');
      if (!query) throw new CliError('search needs a query.');
      return search(query, json);
    }
    case 'paths':
      return paths(json);
    default:
      throw new CliError(`Unknown command "${command}". Run \`lemma --help\` for the command list.`);
  }
}

function main(): void {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${red('error')} ${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    // An unexpected fault is a bug in this tool, not a verdict about the
    // user's science. Exit 2 (usage/environment), never 1 — a pipeline must
    // not read a crash here as "the check failed".
    process.stderr.write(`${red('internal error')} ${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 2;
  }
}

// Only run when invoked as a binary, so the test suite can import `run` without
// the module executing itself on import. Compared as resolved paths rather than
// by filename suffix, which would also match an unrelated `index.js`.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

export { main };
