import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { coverCount, describeDrift, driftBetween, onlyRendered, parseStamp, stampFor } from './publish.ts';
import type { PublishStamp } from './publish.ts';
import { auditPhotos } from './derivatives.ts';
import type { Manifest, Photo } from './types.ts';

const manifest = (chapters: string[][]): Manifest =>
  ({
    generatedAt: '2026-08-13T00:00:00.000Z',
    count: chapters.flat().length,
    chapters: chapters.map((ids, i) => ({
      key: `hue-${i}`,
      name: `Chapter ${i}`,
      oklch: { L: 0.5, C: 0.1, H: 200 },
      photos: ids.map((id) => ({ id })),
    })),
  } as unknown as Manifest);

const NOW = new Date('2026-08-13T12:00:00.000Z');

const stamp = (builtAt: string, photos: string[]): PublishStamp => ({
  builtAt,
  count: photos.length,
  chapters: 1,
  photos,
});

describe('stampFor', () => {
  it('records the photographs in the order the archive presents them', () => {
    const s = stampFor(manifest([['a', 'b'], ['c']]), NOW);
    assert.deepEqual(s.photos, ['a', 'b', 'c']);
    assert.equal(s.count, 3);
    assert.equal(s.chapters, 2);
    assert.equal(s.builtAt, '2026-08-13T12:00:00.000Z');
  });
});

describe('parseStamp', () => {
  it('reads a stamp back', () => {
    const s = parseStamp({ builtAt: '2026-08-03T09:00:00.000Z', count: 69, chapters: 8, photos: ['a'] });
    assert.equal(s?.count, 69);
    assert.deepEqual(s?.photos, ['a']);
  });

  it('refuses anything that is not one, rather than inventing a count', () => {
    assert.equal(parseStamp(null), null);
    assert.equal(parseStamp('<!doctype html>'), null);
    assert.equal(parseStamp({ count: 69 }), null);
  });

  it('refuses a builtAt that will not parse, rather than reporting a null age', () => {
    assert.equal(parseStamp({ builtAt: 'yesterday', count: 69, photos: [] }), null);
    assert.equal(parseStamp({ builtAt: '', count: 69 }), null);
  });

  it('survives a stamp from an older build that carried no photo list', () => {
    const s = parseStamp({ builtAt: '2026-08-03T09:00:00.000Z', count: 69 });
    assert.deepEqual(s?.photos, []);
    assert.equal(s?.chapters, 0);
  });
});

describe('driftBetween', () => {
  it('names the photographs a publish would add', () => {
    const local = stampFor(manifest([['a', 'b', 'c']]), NOW);
    const drift = driftBetween(local, stamp('2026-08-03T09:00:00.000Z', ['a']), NOW);
    assert.deepEqual(drift.added, ['b', 'c']);
    assert.deepEqual(drift.removed, []);
    assert.equal(drift.ageDays, 10);
    assert.ok(drift.drifted);
  });

  it('names the ones a publish would take away', () => {
    const local = stampFor(manifest([['a']]), NOW);
    const drift = driftBetween(local, stamp('2026-08-13T09:00:00.000Z', ['a', 'gone']), NOW);
    assert.deepEqual(drift.removed, ['gone']);
    assert.equal(drift.ageDays, 0);
  });

  it('calls a site with no stamp drifted, because that is the state this was written for', () => {
    const local = stampFor(manifest([['a']]), NOW);
    const drift = driftBetween(local, null, NOW);
    assert.ok(drift.drifted);
    assert.equal(drift.ageDays, null);
    // Nothing is claimed about which photographs are missing — nothing is known.
    assert.deepEqual(drift.added, []);
    assert.deepEqual(drift.removed, []);
  });

  it('is quiet when the two agree', () => {
    const local = stampFor(manifest([['a', 'b']]), NOW);
    const drift = driftBetween(local, stamp('2026-08-13T11:00:00.000Z', ['a', 'b']), NOW);
    assert.equal(drift.drifted, false);
    const text = describeDrift(drift, (id) => id).join('\n');
    // Only about photographs: the functions probe is printed beside this line,
    // and a summary that talks over a 404 measured a moment earlier is worse
    // than no summary at all.
    assert.match(text, /has the same photographs as this archive/);
    assert.doesNotMatch(text, /functions/i);
  });

  it('compares counts only, when the published stamp names no photographs', () => {
    // An older build stamped a count and no list. Differencing against its empty
    // list would call all 79 photographs new when nothing had changed at all.
    const local = stampFor(manifest([['a', 'b']]), NOW);
    const drift = driftBetween(local, { builtAt: '2026-08-13T11:00:00.000Z', count: 2, chapters: 1, photos: [] }, NOW);
    assert.deepEqual(drift.added, []);
    assert.deepEqual(drift.removed, []);
    assert.equal(drift.named, false);
    assert.equal(drift.drifted, false);
    const text = describeDrift(drift, (id) => id).join('\n');
    assert.match(text, /does not name them, so only the counts were compared/);
  });

  it('still reports drift by count when the stamp names no photographs', () => {
    const local = stampFor(manifest([['a', 'b', 'c']]), NOW);
    const drift = driftBetween(local, { builtAt: '2026-08-13T11:00:00.000Z', count: 2, chapters: 1, photos: [] }, NOW);
    assert.ok(drift.drifted);
    assert.deepEqual(drift.added, []); // which ones is not known, and is not guessed
  });

  it('notices a count that disagrees even when the ids line up', () => {
    const local = stampFor(manifest([['a']]), NOW);
    const odd = { ...stamp('2026-08-13T11:00:00.000Z', ['a']), count: 7 };
    assert.ok(driftBetween(local, odd, NOW).drifted);
  });
});

describe('describeDrift', () => {
  it('names photographs by filename, not by hash', () => {
    const local = stampFor(manifest([['a', 'b']]), NOW);
    const drift = driftBetween(local, stamp('2026-08-03T09:00:00.000Z', ['a']), NOW);
    const text = describeDrift(drift, (id) => `DSC0${id}.jpg`).join('\n');
    assert.match(text, /Would add 1 photograph:/);
    assert.match(text, /DSC0b\.jpg/);
    assert.match(text, /built 2026-08-03 \(10 days ago\)/);
  });

  it('says plainly that there is no stamp rather than reporting zero photographs', () => {
    const local = stampFor(manifest([['a']]), NOW);
    const text = describeDrift(driftBetween(local, null, NOW), (id) => id).join('\n');
    assert.match(text, /no stamp/);
    assert.doesNotMatch(text, /Published: 0/);
  });

  it('falls back to the count on the published cover when there is no stamp', () => {
    const local = stampFor(manifest([['a']]), NOW);
    const drift = driftBetween(local, null, NOW, { count: 69, chapters: 8 });
    assert.match(describeDrift(drift, (id) => id).join('\n'), /cover says 69 photographs · 8 chapters/);
  });
});

describe('onlyRendered', () => {
  // The archive and the inspiration board keep separate stores and write their
  // derivatives into the same public/img. Auditing one without the other is what
  // deleted every file behind the board.
  const photo = (id: string, files: string[]): Photo =>
    ({
      id,
      filename: `${id}.jpg`,
      width: 4000,
      derivatives: files.map((f) => ({ width: Number(f.split('-')[1]), avif: `/img/${f}` })),
    } as unknown as Photo);

  const archive = photo('aaaa', ['aaaa-640.avif', 'aaaa-1280.avif', 'aaaa-2000.avif']);
  const board = photo('bbbb', ['bbbb-640.avif', 'bbbb-1280.avif', 'bbbb-2000.avif']);
  const onDisk = ['aaaa-640.avif', 'aaaa-1280.avif', 'aaaa-2000.avif', 'bbbb-640.avif', 'bbbb-1280.avif', 'bbbb-2000.avif'];
  const rendered = new Set(['aaaa']);

  it('does not call a reference on the board an orphan', () => {
    const audit = onlyRendered(auditPhotos([archive, board], onDisk), rendered);
    assert.deepEqual(audit.orphans, []);
  });

  it('would call it an orphan if the board were left out — the regression, stated', () => {
    const audit = auditPhotos([archive], onDisk);
    assert.equal(audit.orphans.length, 3);
  });

  it('does not block a publish over a hole on a board the publish does not carry', () => {
    const audit = onlyRendered(auditPhotos([archive, board], ['aaaa-640.avif', 'aaaa-1280.avif', 'aaaa-2000.avif']), rendered);
    assert.equal(audit.missing.length, 0);
  });

  it('still blocks on a hole in a photograph the page renders', () => {
    const audit = onlyRendered(auditPhotos([archive, board], ['aaaa-640.avif', ...onDisk.slice(3)]), rendered);
    assert.deepEqual(
      audit.missing.map((m) => m.file),
      ['aaaa-1280.avif', 'aaaa-2000.avif'],
    );
  });
});

describe('coverCount', () => {
  it('reads the count off a published cover', () => {
    const html = '<p class="cover-kicker">\n      69 · 8 chapters\n    </p>';
    assert.deepEqual(coverCount(html), { count: 69, chapters: 8 });
  });

  it('reads it through Astro\'s scoped-style attribute', () => {
    const html = '<p class="cover-kicker" data-astro-cid-x3y="">79 · 8 chapters</p>';
    assert.deepEqual(coverCount(html), { count: 79, chapters: 8 });
  });

  it('returns nothing rather than a guess when the cover says something else', () => {
    assert.equal(coverCount('<p class="cover-kicker">In colour</p>'), null);
    assert.equal(coverCount('<h1>Colour Archive</h1>'), null);
  });
});
