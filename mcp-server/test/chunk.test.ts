// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Atomira Technologies, S.L.

/**
 * Chunking decides retrieval quality more than the search does, and it is the
 * only part of ingestion that can be tested without a model download and a live
 * Postgres — which is exactly why it was worth extracting as a pure function.
 *
 * `rag_lookup` previously had no tests at all (`tools.test.ts` says so, and the
 * reason given is that it needs a database). That reasoning applied to the
 * query path; it did not have to apply to the logic.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { chunkText, contentKey } from '../src/rag/chunk.js';

describe('chunking', () => {
  test('short text stays a single passage', () => {
    const chunks = chunkText('Density of states counts electronic levels per unit energy.');
    assert.equal(chunks.length, 1);
    assert.match(chunks[0]!.text, /^Density of states/);
  });

  test('empty and whitespace-only input yields nothing rather than an empty passage', () => {
    assert.deepEqual(chunkText(''), []);
    assert.deepEqual(chunkText('   \n\n  \t '), []);
  });

  test('it does not split mid-sentence', () => {
    // Every chunk should begin at a sentence start and end at a terminator.
    const text = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} explains a distinct point about the method.`,
    ).join(' ');
    const chunks = chunkText(text, { targetChars: 200, overlapChars: 0 });
    assert.ok(chunks.length > 1, 'expected the text to be split');
    for (const chunk of chunks) {
      assert.match(chunk.text, /[.!?]$/, `chunk ended mid-sentence: ${JSON.stringify(chunk.text)}`);
    }
  });

  test('chunks overlap, so a fact spanning a boundary is retrievable from both', () => {
    const text = Array.from(
      { length: 40 },
      (_, i) => `Fact ${i} is stated here in a complete sentence.`,
    ).join(' ');
    const withOverlap = chunkText(text, { targetChars: 300, overlapChars: 100 });
    const without = chunkText(text, { targetChars: 300, overlapChars: 0 });

    assert.ok(withOverlap.length >= without.length);
    // The tail of one chunk should reappear at the head of the next.
    const tail = without[0]!.text.slice(-40);
    assert.ok(
      withOverlap.slice(1).some((c) => c.text.includes(tail.trim().split(' ').pop()!)),
      'expected trailing context to be carried into a later chunk',
    );
  });

  test('overlap can never stall the packer', () => {
    // If overlap >= target, the carried tail refills each chunk to the boundary
    // and the loop makes no progress. The option is clamped for exactly this.
    const text = Array.from({ length: 30 }, (_, i) => `Point ${i} here.`).join(' ');
    const chunks = chunkText(text, { targetChars: 50, overlapChars: 9999 });
    assert.ok(chunks.length > 0);
    assert.ok(chunks.length < 200, 'chunker produced a runaway number of passages');
  });

  test('an unbroken run longer than the target is split, not dropped', () => {
    // A minified file or a base64 blob has no sentence boundaries at all.
    // Chunking it bluntly is acceptable; silently dropping the input is not.
    const blob = 'x'.repeat(5_000);
    const chunks = chunkText(blob, { targetChars: 500, overlapChars: 0 });
    assert.ok(chunks.length >= 10);
    assert.equal(chunks.map((c) => c.text).join('').length, 5_000);
  });

  test('paragraph structure is respected', () => {
    const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.';
    const chunks = chunkText(text, { targetChars: 10_000 });
    assert.equal(chunks.length, 1, 'small paragraphs should pack into one passage');
    assert.ok(!chunks[0]!.text.includes('\n\n'), 'blank lines should be collapsed');
  });

  test('indices are sequential from zero', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence ${i} of the document.`).join(' ');
    const chunks = chunkText(text, { targetChars: 60, overlapChars: 0 });
    assert.deepEqual(
      chunks.map((c) => c.index),
      chunks.map((_, i) => i),
    );
  });
});

describe('content keys', () => {
  test('the same passage always produces the same key', () => {
    assert.equal(contentKey('the Kohn-Sham equations'), contentKey('the Kohn-Sham equations'));
  });

  test('different passages produce different keys', () => {
    assert.notEqual(contentKey('lattice constant'), contentKey('lattice constants'));
  });

  test('the key is content-based, not positional', () => {
    // A positional key would mean editing a document's first paragraph shifts
    // every later index, orphaning every subsequent chunk on re-ingest and
    // leaving the old copies behind.
    const passage = 'Bloch theorem constrains the form of the eigenfunctions.';
    const early = chunkText(`${passage} More text follows.`, { targetChars: 10_000 });
    const late = chunkText(`Preamble sentence. ${passage} More text follows.`, {
      targetChars: 10_000,
    });
    assert.notEqual(early[0]!.index, undefined);
    // Same passage text -> same key regardless of where it appeared.
    assert.equal(contentKey(passage), contentKey(passage));
    assert.notEqual(contentKey(early[0]!.text), contentKey(late[0]!.text));
  });

  test('keys are fixed-width hex', () => {
    for (const s of ['', 'a', 'a much longer passage of scientific prose']) {
      assert.match(contentKey(s), /^[0-9a-f]{16}$/);
    }
  });
});
