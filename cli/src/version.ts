// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Kept in step with `package.json` by a test, rather than read from it at
 * runtime: importing the manifest would need `resolveJsonModule` plus a
 * `files` entry, and would drift silently if either were dropped.
 */
export const VERSION = '0.1.0';
