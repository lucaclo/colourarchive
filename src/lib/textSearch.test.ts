/**
 * Tests for `rankByTextQuery` — pure cosine-similarity ranking against a
 * fixture query vector. The CLIP model itself (embedding real photos and real
 * captions) is verified separately, by hand, against real files — not here;
 * see clip.ts's module comment. This file only needs to prove the ranking
 * math: sorted best-first, unembedded photos excluded rather than scored 0,
 * length mismatches treated the same as missing, order stable for ties.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rankByTextQuery, relevantByLift, queryPrompt, MIN_LIFT } from './textSearch.ts';
import type { Photo } from './types.ts';

let n = 0;
/** A Photo with only the field rankByTextQuery reads. */
const photo = (clipEmbedding?: number[]): Photo =>
  ({ id: `p${n++}`, clipEmbedding } as unknown as Photo);

describe('rankByTextQuery', () => {
  it('sorts candidates best-match-first by cosine similarity', () => {
    const query = [1, 0, 0];
    const close = photo([0.9, 0.1, 0]);
    const mid = photo([0.5, 0.5, 0]);
    const far = photo([0, 0, 1]);
    const rows = rankByTextQuery(query, [far, mid, close]);
    assert.deepEqual(rows.map((r) => r.photo), [close, mid, far]);
    assert.ok(rows[0].score > rows[1].score);
    assert.ok(rows[1].score > rows[2].score);
  });

  it('excludes photos with no clipEmbedding rather than scoring them 0', () => {
    const query = [1, 0, 0];
    const embedded = photo([1, 0, 0]);
    const missing = photo(undefined);
    const rows = rankByTextQuery(query, [missing, embedded]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].photo, embedded);
  });

  it('excludes a clipEmbedding of the wrong length, same as missing', () => {
    const query = [1, 0, 0];
    const embedded = photo([1, 0, 0]);
    const mismatched = photo([1, 0]);
    const rows = rankByTextQuery(query, [mismatched, embedded]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].photo, embedded);
  });

  it('an identical vector scores 1 (cosine similarity ceiling); an opposite one scores -1', () => {
    const query = [1, 0, 0];
    const identical = photo([1, 0, 0]);
    const opposite = photo([-1, 0, 0]);
    const [rIdentical, rOpposite] = rankByTextQuery(query, [identical, opposite]);
    assert.equal(rIdentical.score, 1);
    assert.equal(rOpposite.score, -1);
  });

  it('returns an empty list for an empty candidate set, not an error', () => {
    assert.deepEqual(rankByTextQuery([1, 0, 0], []), []);
  });

  it('preserves input order among exact ties (stable sort)', () => {
    const query = [1, 0, 0];
    const a = photo([1, 0, 0]);
    const b = photo([1, 0, 0]);
    const c = photo([1, 0, 0]);
    const rows = rankByTextQuery(query, [a, b, c]);
    assert.deepEqual(rows.map((r) => r.photo), [a, b, c]);
  });
});

describe('relevantByLift', () => {
  const base = [0, 0, 1];
  it('keeps only photos lifted well above the baseline, best first', () => {
    const q = [1, 0, 0];
    const strong = photo([0.3, 0, 0.1]);  // lift 0.2
    const weak = photo([0.15, 0, 0.1]);   // lift 0.05, under half the best
    const none = photo([0, 0, 1]);
    const rows = relevantByLift(q, base, [none, weak, strong]);
    assert.deepEqual(rows.map((r) => r.photo), [strong]);
  });
  it('returns nothing when no photo lifts past the floor', () => {
    const q = [1, 0, 0];
    const rows = relevantByLift(q, base, [photo([MIN_LIFT / 2, 0, 1]), photo([0, 0, 1])]);
    assert.equal(rows.length, 0);
  });
  it('keeps everything within half of the best lift', () => {
    const q = [1, 0, 0];
    const a = photo([0.1, 0, 0]), b = photo([0.06, 0, 0]), c = photo([0.04, 0, 0]);
    assert.deepEqual(relevantByLift(q, base, [c, b, a]).map((r) => r.photo), [a, b]);
  });
  it('words a query the way CLIP was trained on', () => {
    assert.equal(queryPrompt(' boat. '), 'a photo of boat.');
  });
});
