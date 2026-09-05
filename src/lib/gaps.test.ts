import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findColourGaps, findGenreColourGaps } from './gaps.ts';
import { ANCHORS } from './color.ts';
import type { OKLCH } from './color.ts';
import type { Chapter, Genre, Photo } from './types.ts';

const photo = (H: number, extra: Partial<Photo> = {}): Photo => {
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
    ...extra,
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

describe('findGenreColourGaps', () => {
  const blue = ANCHORS.find((a) => a.slug === 'blue')!;
  const genrePhotos = (genre: Genre, n: number, anchorSlug = blue.slug) =>
    Array.from({ length: n }, () => photo(blue.H, { chapter: anchorSlug, genre }));

  it('flags a genre never shot in a hue the archive otherwise shoots plenty of', () => {
    const photos = [...genrePhotos('landscape', 10), ...genrePhotos('street', 5)];
    const gaps = findGenreColourGaps(photos);
    assert.ok(gaps.some((g) => g.anchorKey === 'blue' && g.genre === 'portrait'));
    assert.ok(gaps.some((g) => g.anchorKey === 'blue' && g.genre === 'architecture'));
    assert.ok(!gaps.some((g) => g.anchorKey === 'blue' && g.genre === 'landscape'));
    assert.ok(!gaps.some((g) => g.anchorKey === 'blue' && g.genre === 'street'));
  });

  it('reports nothing once every genre is represented at an anchor', () => {
    const photos = [
      ...genrePhotos('landscape', 5),
      ...genrePhotos('street', 5),
      ...genrePhotos('portrait', 5),
      ...genrePhotos('architecture', 5),
    ];
    assert.deepEqual(findGenreColourGaps(photos), []);
  });

  it('ignores an anchor with too few genre-labelled photos to mean anything', () => {
    // Two landscape photos at 'red' — below MIN_GENRE_SAMPLE — should not
    // manufacture "missing portrait/street/architecture" out of a sample of two.
    const red = ANCHORS.find((a) => a.slug === 'red')!;
    const photos = [photo(red.H, { chapter: 'red', genre: 'landscape' }), photo(red.H, { chapter: 'red', genre: 'landscape' })];
    assert.deepEqual(findGenreColourGaps(photos), []);
  });

  it('never reports achromatic — it is not a hue', () => {
    const photos = Array.from({ length: 10 }, () => photo(0, { chapter: 'achromatic', genre: 'street' }));
    assert.deepEqual(findGenreColourGaps(photos), []);
  });

  it('leaves out photos with no genre rather than counting them as "not this genre"', () => {
    // Three genreless photos at an anchor must not, by themselves, manufacture
    // gaps for all four genres — there is no evidence about genre here at all.
    const photos = Array.from({ length: 3 }, () => photo(blue.H, { chapter: 'blue', genre: undefined }));
    assert.deepEqual(findGenreColourGaps(photos), []);
  });

  it('is stable over an empty archive', () => {
    assert.deepEqual(findGenreColourGaps([]), []);
  });
});
