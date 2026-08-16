import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessedSearchUrl,
  byStanding,
  parsePhotoDetails,
  parseSearchTitles,
  photoDetailsUrl,
  type Accolade,
} from './wikimedia.ts';
import type { RawPhoto } from './types.ts';

const CENTRE = { lat: 55.9533, lon: -3.1883 };

/** The search expression for one tier, which is what most of these assert on. */
const of = (tier: Accolade) =>
  new URL(assessedSearchUrl({ centre: CENTRE, radiusM: 5000, limit: 10 }, tier)).searchParams.get(
    'srsearch',
  ) ?? '';

const page = (over: Record<string, unknown> = {}, info: Record<string, unknown> = {}) => ({
  pageid: 1,
  title: 'File:Calton Hill at dawn.jpg',
  coordinates: [{ lat: 55.9553, lon: -3.1828 }],
  imageinfo: [
    {
      mime: 'image/jpeg',
      width: 4000,
      height: 3000,
      thumburl: 'https://upload.wikimedia.org/thumb/calton.jpg',
      thumbwidth: 480,
      thumbheight: 320,
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Calton_Hill_at_dawn.jpg',
      extmetadata: {
        Artist: { value: '<a href="/wiki/User:Someone">A Photographer</a>' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
        LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' },
        DateTimeOriginal: { value: '2024-06-21' },
        ...(info.extmetadata as object),
      },
      ...info,
    },
  ],
  ...over,
});

describe('assessedSearchUrl', () => {
  it('searches the intersection of an accolade and a place', () => {
    // The whole point: distance alone returns bulk-imported grid squares.
    const url = new URL(assessedSearchUrl({ centre: CENTRE, radiusM: 15_000, limit: 50 }, 'quality'));
    const search = url.searchParams.get('srsearch') ?? '';
    assert.match(search, /incategory:"Quality images"/);
    assert.match(search, /nearcoord:15km,55\.9533,-3\.1883/);
    assert.equal(url.searchParams.get('srnamespace'), '6', 'namespace 6 is File:');
    assert.equal(url.searchParams.get('srlimit'), '50');
  });

  it('uses the right category for each tier', () => {
    assert.match(of('featured'), /Featured pictures on Wikimedia Commons/);
    assert.match(of('quality'), /Quality images/);
    assert.match(of('valued'), /Valued images/);
    assert.match(of('contest'), /Images from Wiki Loves Earth/);
  });

  it('walks the subcategories for the tiers that are filed in them', () => {
    // `Category:Valued images` holds three files; every promoted one is in a
    // subcategory. Asking with `incategory:` returned nothing, everywhere, and
    // looked exactly like a place with no valued images. Same for Wiki Loves
    // Earth, which is filed by year and country.
    assert.match(of('valued'), /deepcat:"Valued images"/);
    assert.match(of('contest'), /deepcat:"Images from Wiki Loves Earth"/);
    assert.doesNotMatch(of('valued'), /incategory:/);
  });

  it('keeps direct membership where Commons files them directly', () => {
    // Not a preference — quality images really are in `Category:Quality
    // images`, and `deepcat:` there would drag in the whole review apparatus.
    assert.match(of('quality'), /incategory:"Quality images"/);
    assert.match(of('featured'), /incategory:"Featured pictures on Wikimedia Commons"/);
  });

  it('asks in kilometres, which is not what geosearch takes', () => {
    // `nearcoord` is km and `geosearch` is metres — an easy way to search a
    // thousand times too small an area.
    const url = new URL(assessedSearchUrl({ centre: CENTRE, radiusM: 8000, limit: 10 }, 'quality'));
    assert.match(url.searchParams.get('srsearch') ?? '', /nearcoord:8km,/);
  });

  it('never asks for a radius of zero kilometres', () => {
    const url = new URL(assessedSearchUrl({ centre: CENTRE, radiusM: 100, limit: 10 }, 'quality'));
    assert.match(url.searchParams.get('srsearch') ?? '', /nearcoord:1km,/);
  });
});

describe('photoDetailsUrl', () => {
  it('asks for position and provenance in one call', () => {
    const url = new URL(photoDetailsUrl(['File:A.jpg', 'File:B.jpg']));
    assert.equal(url.searchParams.get('titles'), 'File:A.jpg|File:B.jpg');
    assert.match(url.searchParams.get('prop') ?? '', /coordinates/);
    assert.match(url.searchParams.get('iiprop') ?? '', /extmetadata/);
  });
});

describe('parseSearchTitles', () => {
  it('reads titles in the order Commons ranked them', () => {
    const titles = parseSearchTitles({
      query: { search: [{ title: 'File:One.jpg' }, { title: 'File:Two.jpg' }] },
    });
    assert.deepEqual(titles, ['File:One.jpg', 'File:Two.jpg']);
  });

  it('keeps only files', () => {
    const titles = parseSearchTitles({
      query: { search: [{ title: 'Category:Nope' }, { title: 'File:Yes.jpg' }, { title: 5 }] },
    });
    assert.deepEqual(titles, ['File:Yes.jpg']);
  });

  it('is empty rather than broken when the shape is wrong', () => {
    for (const bad of [null, {}, { query: {} }, { query: { search: 'nope' } }]) {
      assert.deepEqual(parseSearchTitles(bad), []);
    }
  });
});

describe('parsePhotoDetails', () => {
  it('reads a whole photograph, attribution and standing included', () => {
    const [photo] = parsePhotoDetails({ query: { pages: [page()] } }, 'quality');
    assert.equal(photo.title, 'Calton Hill at dawn.jpg');
    assert.equal(photo.author, 'A Photographer', 'markup stripped, name kept');
    assert.equal(photo.licence.name, 'CC BY-SA 4.0');
    assert.deepEqual(photo.at, { lat: 55.9553, lon: -3.1828 });
    assert.equal(photo.accolade, 'quality');
    assert.equal(photo.megapixels, 12);
  });

  it('never invents a bearing', () => {
    const [photo] = parsePhotoDetails({ query: { pages: [page()] } }, 'quality');
    assert.equal(photo.bearing, undefined);
  });

  it('drops a file with no author rather than showing it anonymously', () => {
    const anonymous = page({}, { extmetadata: { Artist: { value: '' } } });
    assert.deepEqual(parsePhotoDetails({ query: { pages: [anonymous] } }, 'quality'), []);
  });

  it('drops a file with no licence', () => {
    const unlicensed = page({}, { extmetadata: { LicenseShortName: { value: '' }, License: { value: '' } } });
    assert.deepEqual(parsePhotoDetails({ query: { pages: [unlicensed] } }, 'quality'), []);
  });

  it('drops a photograph that is not anywhere', () => {
    // A spot photograph with no position is not a spot photograph.
    assert.deepEqual(parsePhotoDetails({ query: { pages: [page({ coordinates: undefined })] } }, 'quality'), []);
  });

  it('drops what is not a photograph', () => {
    for (const mime of ['application/pdf', 'image/svg+xml', 'video/webm', 'image/gif']) {
      assert.deepEqual(parsePhotoDetails({ query: { pages: [page({}, { mime })] } }, 'quality'), [], mime);
    }
  });

  it('leaves an unreadable date undefined instead of guessing', () => {
    for (const value of ['', 'sometime in the 90s', '0001-01-01']) {
      const odd = page({}, { extmetadata: { DateTimeOriginal: { value } } });
      const [photo] = parsePhotoDetails({ query: { pages: [odd] } }, 'quality');
      assert.equal(photo?.takenAt, undefined, value);
    }
  });

  it('survives a response with no pages at all', () => {
    assert.deepEqual(parsePhotoDetails({}, 'quality'), []);
    assert.deepEqual(parsePhotoDetails({ query: { pages: [] } }, 'quality'), []);
  });
});

describe('byStanding', () => {
  const photo = (accolade: RawPhoto['accolade'], megapixels: number): RawPhoto => ({
    id: `${accolade}-${megapixels}`,
    source: 'wikimedia',
    at: CENTRE,
    originUrl: 'x',
    thumbUrl: 'x',
    thumbWidth: 1,
    thumbHeight: 1,
    title: 't',
    author: 'a',
    licence: { name: 'l' },
    accolade,
    megapixels,
  });

  it('puts what the reviewers rated highest first', () => {
    const sorted = [photo('valued', 40), photo('quality', 8), photo('featured', 2)].sort(byStanding);
    assert.deepEqual(sorted.map((p) => p.accolade), ['featured', 'quality', 'valued']);
  });

  it('breaks a tie on resolution, which is blunt but real', () => {
    const sorted = [photo('quality', 6), photo('quality', 24), photo('quality', 12)].sort(byStanding);
    assert.deepEqual(sorted.map((p) => p.megapixels), [24, 12, 6]);
  });

  it('ranks an unassessed photograph below every assessed one', () => {
    const sorted = [photo(undefined, 60), photo('valued', 1)].sort(byStanding);
    assert.deepEqual(sorted.map((p) => p.accolade), ['valued', undefined]);
  });

  it('puts a contest entry under every reviewed tier, however large it is', () => {
    // Wiki Loves Earth says somebody meant to make the picture. It does not say
    // anybody thought it was good, so forty megapixels of it must not outrank a
    // photograph three other photographers voted for.
    const sorted = [photo('contest', 60), photo('valued', 1), photo('featured', 1)].sort(byStanding);
    assert.deepEqual(sorted.map((p) => p.accolade), ['featured', 'valued', 'contest']);
  });

  it('still ranks a contest entry above a photograph with no standing at all', () => {
    const sorted = [photo(undefined, 60), photo('contest', 1)].sort(byStanding);
    assert.deepEqual(sorted.map((p) => p.accolade), ['contest', undefined]);
  });
});

/* ── Reaching Commons from a page ──────────────────────────────────────────── */

describe('the CORS opt-in', () => {
  const QUERY = { centre: CENTRE, radiusM: 5000, limit: 10 } as const;

  it('is absent by default, because the server does not need it', () => {
    assert.equal(new URL(assessedSearchUrl(QUERY, 'quality')).searchParams.get('origin'), null);
    assert.equal(new URL(photoDetailsUrl(['File:A.jpg'])).searchParams.get('origin'), null);
  });

  it('asks for an anonymous cross-origin read when the page is doing the fetching', () => {
    // `origin=*` is Commons' documented opt-in. Without it a browser gets an
    // opaque failure and the photo layer comes back empty with nothing in the
    // console to say why.
    const search = new URL(assessedSearchUrl(QUERY, 'quality', { cors: true }));
    const details = new URL(photoDetailsUrl(['File:A.jpg'], 320, { cors: true }));
    assert.equal(search.searchParams.get('origin'), '*');
    assert.equal(details.searchParams.get('origin'), '*');
  });

  it('changes nothing else about either request', () => {
    for (const [plain, cors] of [
      [assessedSearchUrl(QUERY, 'featured'), assessedSearchUrl(QUERY, 'featured', { cors: true })],
      [photoDetailsUrl(['File:A.jpg', 'File:B.jpg']), photoDetailsUrl(['File:A.jpg', 'File:B.jpg'], 320, { cors: true })],
    ]) {
      const before = new URL(plain).searchParams;
      const after = new URL(cors).searchParams;
      after.delete('origin');
      assert.deepEqual([...after].sort(), [...before].sort());
    }
  });

  it('treats an explicit false the same as saying nothing', () => {
    assert.equal(assessedSearchUrl(QUERY, 'quality', { cors: false }), assessedSearchUrl(QUERY, 'quality'));
  });
});
