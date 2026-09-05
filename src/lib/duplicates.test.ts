/**
 * `duplicateGroups` single-links photos within one chapter whose embedding
 * distance sits under an absolute ceiling AND whose capture times (where
 * both are known) are consistent with one session. See duplicates.ts's own
 * module comment for why this is a fixed ceiling rather than
 * `clusterByEmbedding`'s (similar.ts) percentile-of-the-set approach, and
 * why scoping stays per chapter.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { duplicateGroups } from './duplicates.ts';
import type { Photo } from './types.ts';

const photo = (id: string, embedding: number[], capturedAt?: string): Photo =>
  ({ id, embedding, exif: { capturedAt } } as unknown as Photo);

describe('duplicateGroups', () => {
  it('finds a burst within one chapter', () => {
    const chapters = [
      {
        key: 'hue-030',
        photos: [
          photo('a1', [1.0], '2026-08-16T19:47:13Z'),
          photo('a2', [0.9], '2026-08-16T19:46:03Z'), // close embedding, minutes apart
          photo('loner', [0]), // far from everything
        ],
      },
    ];
    const groups = duplicateGroups(chapters);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].ids.sort(), ['a1', 'a2']);
    assert.equal(groups[0].chapterKey, 'hue-030');
  });

  it('never groups across a chapter boundary, even when embeddings would otherwise cluster', () => {
    const chapters = [
      { key: 'hue-030', photos: [photo('a1', [1.0])] },
      { key: 'hue-060', photos: [photo('a2', [0.9])] },
    ];
    assert.deepEqual(duplicateGroups(chapters), []);
  });

  it('drops a pair that sits well within the distance ceiling but was shot on two different days', () => {
    const chapters = [
      {
        key: 'teal',
        photos: [
          photo('a', [1.0], '2026-08-07T16:54:40Z'),
          photo('b', [0.85], '2026-08-08T13:24:39Z'), // dist 0.15, well under the ceiling — but ~20.5h later, a different visit
        ],
      },
    ];
    assert.deepEqual(duplicateGroups(chapters), []);
  });

  it('drops a pair too far apart in embedding space even when shot moments apart', () => {
    const chapters = [
      {
        key: 'teal',
        photos: [
          photo('a', [1.0], '2026-08-16T19:00:00Z'),
          photo('b', [0.5], '2026-08-16T19:00:30Z'), // dist 0.5 — clearly different subjects, 30s apart
        ],
      },
    ];
    assert.deepEqual(duplicateGroups(chapters), []);
  });

  it('keeps a close pair with no capture time at all — film has none, and that is not evidence against it', () => {
    const chapters = [
      { key: 'yellow-deep', photos: [photo('a', [1.0]), photo('b', [0.9])] }, // no capturedAt on either
    ];
    const groups = duplicateGroups(chapters);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].ids.sort(), ['a', 'b']);
  });

  it('bridges a three-frame burst even though the first and last alone fall outside the time window', () => {
    // Three 2-D unit vectors 15° apart (0°, 15°, 30°): every pairwise
    // distance is under the ceiling, including first-to-last (dist 0.13 at
    // 30° apart), so all three would single-link on embedding alone — the
    // point of this test is the time bridge, not the distance gate.
    const v = (deg: number): number[] => {
      const r = (deg * Math.PI) / 180;
      return [Math.cos(r), Math.sin(r)];
    };
    const chapters = [
      {
        key: 'orange',
        photos: [
          photo('first', v(0), '2026-08-16T19:00:00Z'),
          photo('middle', v(15), '2026-08-16T19:20:00Z'), // 20 min from first, 25 from last — bridges both
          photo('last', v(30), '2026-08-16T19:45:00Z'), // 45 min from first — outside the window alone
        ],
      },
    ];
    const groups = duplicateGroups(chapters);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].ids.sort(), ['first', 'last', 'middle']);
  });

  it('is empty over no chapters', () => {
    assert.deepEqual(duplicateGroups([]), []);
  });
});
