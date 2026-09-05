import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { curatedChapters, orderedChaptersWithExclusions, type BookCuration } from './book.ts';
import type { Chapter, Photo } from './types.ts';

const photo = (id: string): Photo => ({
  id,
  filename: `${id}.jpg`,
  ext: 'jpg',
  width: 1,
  height: 1,
  bytes: 1,
  oklch: { L: 0.5, C: 0.15, H: 0 },
  autoChapter: 'x',
  chapter: 'x',
  autoMedium: 'digital',
  medium: 'digital',
  placeholder: '',
  derivatives: [],
  exif: {},
  addedAt: new Date().toISOString(),
});

const chapter = (key: string, ids: string[]): Chapter => ({
  key,
  name: key,
  oklch: { L: 0.5, C: 0.15, H: 0 },
  photos: ids.map(photo),
});

describe('curatedChapters', () => {
  it('keeps manifest order and every photo when there is no curation at all', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    const result = curatedChapters(chapters, {});
    assert.deepEqual(result[0].photos.map((p) => p.id), ['1', '2', '3']);
  });

  it('reorders a chapter to its saved order', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    const curation: BookCuration = { chapters: { a: ['3', '1', '2'] } };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['3', '1', '2']);
  });

  it('drops an excluded photo from the sequence', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    const curation: BookCuration = { excluded: ['2'] };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['1', '3']);
  });

  it('drops a chapter entirely once every one of its photos is excluded', () => {
    const chapters = [chapter('a', ['1', '2']), chapter('b', ['3'])];
    const curation: BookCuration = { excluded: ['1', '2'] };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result.map((ch) => ch.key), ['b']);
  });

  it('appends a photo ingested since the chapter was last curated, rather than dropping it', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    // Curated back when the chapter only had two photos — '3' arrived later.
    const curation: BookCuration = { chapters: { a: ['2', '1'] } };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['2', '1', '3']);
  });

  it('applies exclusion after the saved order, not instead of it', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    const curation: BookCuration = { chapters: { a: ['3', '2', '1'] }, excluded: ['2'] };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['3', '1']);
  });

  it('ignores a stale id in a saved order that no longer names a photo in the chapter', () => {
    const chapters = [chapter('a', ['1', '2'])];
    const curation: BookCuration = { chapters: { a: ['9', '2', '1'] } };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['2', '1']);
  });

  it('moves a photo into a different chapter for the book, leaving its manifest chapter untouched', () => {
    const chapters = [chapter('a', ['1', '2']), chapter('b', ['3'])];
    const curation: BookCuration = { moved: { '1': 'b' } };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result.map((ch) => ch.key), ['a', 'b']);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['2']);
    assert.deepEqual(result[1].photos.map((p) => p.id), ['3', '1']);
  });

  it('ignores a move to a chapter key the manifest no longer has', () => {
    const chapters = [chapter('a', ['1', '2'])];
    const curation: BookCuration = { moved: { '1': 'ghost' } };
    const result = curatedChapters(chapters, curation);
    assert.deepEqual(result[0].photos.map((p) => p.id), ['1', '2']);
  });
});

describe('orderedChaptersWithExclusions', () => {
  it('keeps an excluded photo in the chapter, marked, rather than dropping it', () => {
    const chapters = [chapter('a', ['1', '2', '3'])];
    const curation: BookCuration = { excluded: ['2'] };
    const result = orderedChaptersWithExclusions(chapters, curation);
    assert.deepEqual(
      result[0].photos.map((p) => [p.id, p.excluded]),
      [['1', false], ['2', true], ['3', false]],
    );
  });

  it('never drops a chapter, even one excluded down to nothing', () => {
    const chapters = [chapter('a', ['1'])];
    const curation: BookCuration = { excluded: ['1'] };
    const result = orderedChaptersWithExclusions(chapters, curation);
    assert.equal(result.length, 1);
    assert.equal(result[0].photos.length, 1);
  });
});
