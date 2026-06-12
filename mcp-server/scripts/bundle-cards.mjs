// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

// Copy the cards corpus into the package's dist/ so the published npm package
// is self-contained. Run by the `prepack` script before `npm pack` / publish.
// The corpus is CC-BY 4.0; its LICENSE travels with it.

import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // mcp-server/scripts
const root = path.resolve(here, '..'); // mcp-server
const src = path.resolve(root, '..', 'cards'); // repo/cards
const dest = path.resolve(root, 'dist', '_corpus'); // mcp-server/dist/_corpus

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`bundled corpus: ${src} -> ${dest}`);
