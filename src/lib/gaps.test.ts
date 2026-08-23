import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findColourGaps } from './gaps.ts';
import { ANCHORS } from './color.ts';
import type { OKLCH } from './color.ts';
import type { Chapter, Photo } from './types.ts';

const photo = (H: number): Photo => {
  const oklch: OKLCH = { L: 0.5, C: 0.15, H };
  return {
    id: `p-${H}-${Math.random()}`,
    filename: 'x.jpg',
    ext: 'jpg',
    width: 1,
    height: 1,
    bytes: 1,
    oklch,
    autoChapter: 'x',
    chapter: 'x',
    autoMedium: 'digital',
    medium: 'digital',
    placeholder: '',
    derivatives: [],
    exif: {},
    addedAt: new Date().toISOString(),
  };
};

const chapter = (key: string, H: number, count: number): Chapter => ({
  key,
  name: key,
  oklch: { L: 0.5, C: 0.15, H },
  photos: Array.from({ length: count }, () => photo(H)),
});

describe('findColourGaps', () => {
  it('flags every anchor with zero photos as missing', () => {
    // Only 'red' filled — the other seven anchors have no chapter at all.
    const red = ANCHORS.find((a) => a.slug === 'red')!;
    const chapters = [chapter('red', red.H, 10)];
    const gaps = findColourGaps(chapters);
    const missing = gaps.filter((g) => g.kind === 'missing');
    assert.equal(missing.length, ANCHORS.length - 1);
    assert.ok(!missing.some((g) => g.anchorKey === 'red'));
  });

  it('never reports achromatic — it is not a hue', () => {
    const chapters = [chapter('achromatic', 0, 3)];
    const gaps = findColourGaps(chapters);
    assert.ok(!gaps.some((g) => g.anchorKey === 'achromatic'));
  });

  it('reports a present-but-small anchor as thin, not missing', () => {
    const red = ANCHORS.find((a) => a.slug === 'red')!;
    const blue = ANCHORS.find((a) => a.slug === 'blue')!;
    const chapters = [chapter('red', red.H, 100), chapter('blue', blue.H, 5)];
    const gaps = findColourGaps(chapters);
    const blueGap = gaps.find((g) => g.anchorKey === 'blue');
    assert.ok(blueGap);
    assert.equal(blueGap!.kind, 'thin');
    assert.equal(blueGap!.photoCount, 5);
  });

  it('sums bands of the same anchor (deep/mid/pale) into one count', () => {
    // red-deep + red + red-pale together clear the thin threshold, even
    // though each band alone would not.
    const red = ANCHORS.find((a) => a.slug === 'red')!;
    const chapters = [
      chapter('red-deep', red.H, 30),
      chapter('red', red.H, 30),
      chapter('red-pale', red.H, 30),
    ];
    const gaps = findColourGaps(chapters);
    assert.ok(!gaps.some((g) => g.anchorKey === 'red'));
  });

  it('reports nothing when every anchor is well represented', () => {
    const chapters = ANCHORS.map((a) => chapter(a.slug, a.H, 20));
    assert.deepEqual(findColourGaps(chapters), []);
  });

  it('is stable when the archive is empty', () => {
    const gaps = findColourGaps([]);
    assert.equal(gaps.length, ANCHORS.length);
    assert.ok(gaps.every((g) => g.kind === 'missing'));
  });
});
