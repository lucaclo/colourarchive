import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPages, padToEven, paginate, placements, spreads, TRIMS, type Page, type PageChapter } from './book-pages';

const ph = (id: string, w = 3, h = 2) => ({ id, width: w, height: h });
const chapters: PageChapter[] = [
  { key: 'red', name: 'Red', colour: 'red', photos: [ph('a'), ph('b'), ph('c')] },
  { key: 'blue', name: 'Blue', colour: 'blue', photos: [ph('d')] },
];
const kinds = (pages: Page[]) =>
  pages.map((p) => (p.kind === 'photo' ? `${p.treatment}:${p.photos.map((x) => x.id).join('+')}` : p.kind));

test('one opener per chapter, one page per photo by default', () => {
  assert.deepEqual(kinds(paginate(chapters)), ['opener', 'border:a', 'border:b', 'border:c', 'opener', 'border:d']);
});

test('a pair takes the next photo onto the same page', () => {
  assert.deepEqual(kinds(paginate(chapters, { treatment: { a: 'pair' } })), ['opener', 'two-up:a+b', 'border:c', 'opener', 'border:d']);
});

test('a pair on the last photo of a chapter falls back, and says why', () => {
  const pages = paginate(chapters, { treatment: { c: 'pair' } });
  const c = pages[3];
  assert.equal(c.kind === 'photo' && c.treatment, 'border');
  assert.ok(c.kind === 'photo' && c.note);
  assert.equal(kinds(pages)[4], 'opener', 'never pairs across a chapter');
});

test('a paired-away photo does not also get its own page', () => {
  const pages = paginate(chapters, { treatment: { a: 'pair', b: 'bleed' } });
  assert.deepEqual(kinds(pages).slice(1, 3), ['two-up:a+b', 'border:c']);
});

test('blank before a photo inserts a page', () => {
  assert.deepEqual(kinds(paginate(chapters, { blankBefore: ['b'] })).slice(0, 4), ['opener', 'border:a', 'blank', 'border:b']);
});

test('spreads start with a lone right-hand page 1', () => {
  assert.deepEqual(spreads([1, 2, 3, 4]), [[null, 1], [2, 3], [4, null]]);
  assert.deepEqual(spreads([1, 2, 3]), [[null, 1], [2, 3]]);
  assert.deepEqual(spreads([]), []);
});

test('padding makes the count even', () => {
  assert.equal(padToEven(paginate(chapters)).length, 6);
  const odd = paginate(chapters, { treatment: { a: 'pair' } });
  assert.equal(odd.length, 5);
  const padded = padToEven(odd);
  assert.equal(padded.length, 6);
  assert.deepEqual(padded[5], { kind: 'blank', reason: 'even' });
});

test('page checks name the service limit', () => {
  const blurb = TRIMS['blurb-land'];
  assert.equal(checkPages(18, blurb).ok, false);
  assert.match(checkPages(18, blurb).message, /needs at least 20/);
  assert.equal(checkPages(24, blurb).ok, true);
  assert.equal(checkPages(242, blurb).ok, false);
  assert.equal(checkPages(4, TRIMS['a4-port']).ok, true, 'no limits off-service');
});

test('a bordered photo fits inside the margins, centred', () => {
  const t = TRIMS['a4-land'];
  const [p] = placements({ kind: 'photo', chapterKey: 'x', photos: [ph('a', 3, 2)], treatment: 'border' }, t);
  assert.ok(p.box.x >= 0 && p.box.y >= 0 && p.box.x + p.box.w <= t.widthMM && p.box.y + p.box.h <= t.heightMM);
  assert.ok(Math.abs(p.box.w / p.box.h - 1.5) < 1e-9);
  assert.ok(Math.abs(p.box.x + p.box.w / 2 - t.widthMM / 2) < 1e-9);
});

test('full bleed covers the bleed box and crops the long side', () => {
  const t = TRIMS['blurb-sq-s'];
  const [p] = placements({ kind: 'photo', chapterKey: 'x', photos: [ph('a', 3, 2)], treatment: 'bleed' }, t);
  assert.ok(p.clip.x < 0 && p.clip.w > t.widthMM, 'reaches into the bleed');
  assert.ok(p.box.w >= p.clip.w && p.box.h >= p.clip.h - 1e-9, 'covers it');
  assert.ok(p.box.x < p.clip.x, 'a landscape frame is cropped at the sides on a square page');
});

test('two landscape photos stack on a portrait page and sit side by side on a landscape one', () => {
  const page = { kind: 'photo' as const, chapterKey: 'x', photos: [ph('a', 3, 2), ph('b', 3, 2)], treatment: 'two-up' as const };
  const port = placements(page, TRIMS['a4-port']);
  assert.ok(port[1].box.y > port[0].box.y + port[0].box.h - 1e-9, 'stacked');
  const land = placements({ ...page, photos: [ph('a', 2, 3), ph('b', 2, 3)] }, TRIMS['a4-land']);
  assert.ok(land[1].box.x > land[0].box.x + land[0].box.w - 1e-9, 'side by side');
});
