// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * A fault in how the command was invoked — a bad card id, unreadable JSON, a
 * missing argument.
 *
 * Kept distinct from a verification failure on purpose. "The physics is out of
 * range" and "you typed the card id wrong" are both non-zero exits, but they
 * are not the same event and a pipeline should be able to tell them apart:
 * usage faults exit 2, verification failures exit 1.
 */
export class CliError extends Error {
  readonly exitCode = 2;
}
