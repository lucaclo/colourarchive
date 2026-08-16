/**
 * Tests for the Commons search sequence.
 *
 * This became testable when the fetching was lifted out of it so the published
 * static build could supply its own. The sequence itself is where all the
 * hard-won behaviour lives — three tiers asked separately because ORing them
 * returns nothing, the dedupe that keeps the best standing, the per-tier batches
 * — and it is now exercised against a recorded transport rather than the live
 * API, so the properties below hold without a network.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { collectCommonsPhotos, toHotspots, type JsonTransport } from './photo-client.ts';
import { ACCOLADES } from './wikimedia.ts';
import type { SpotSearch } from './types.ts';

const CENTRE = { lat: 55.9533, lon: -3.1883 };
const QUERY: SpotSearch = { centre: CENTRE, radiusM: 5000, limit: 20 };

const page = (title: string, over: Record<string, unknown> = {}) => ({
  pageid: title.length,
  title,
  coordinates: [{ lat: 55.9553, lon: -3.1828 }],
  imageinfo: [
    {
      mime: 'image/jpeg',
      width: 4000,
      height: 3000,
      thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}`,
      thumbwidth: 320,
      thumbheight: 240,
      descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
      extmetadata: {
        Artist: { value: 'A Photographer' },
        LicenseShortName: { value: 'CC BY-SA 4.0' },
      },
    },
  ],
  ...over,
});

/**
 * A transport standing in for Commons, driven by a map of accolade to titles.
 * Records every URL it was asked for, which is what most of these assert about.
 */
function recorder(byTier: Partial<Record<string, string[]>>) {
  const urls: string[] = [];
  const transport: JsonTransport = async (url) => {
    urls.push(url);
    const parsed = new URL(url);
    const titles = parsed.searchParams.get('titles');
    if (titles) {
      return { query: { pages: titles.split('|').map((t) => page(t)) } };
    }
    const search = parsed.searchParams.get('srsearch') ?? '';
    const tier = Object.keys(ACCOLADES).find((key) =>
      search.includes(ACCOLADES[key as keyof typeof ACCOLADES].category),
    );
    return { query: { search: (byTier[tier ?? ''] ?? []).map((title) => ({ title })) } };
  };
  return { transport, urls };
}

describe('collectCommonsPhotos', () => {
  it('asks each accolade separately, never as one expression', () => {
    // ORing the categories into one CirrusSearch query returns nothing. That is
    // not obvious from the API docs and it is the reason for one request a tier.
    const { transport, urls } = recorder({ featured: ['File:A.jpg'] });
    return collectCommonsPhotos(QUERY, transport).then(() => {
      const searches = urls.filter((u) => u.includes('srsearch'));
      assert.equal(searches.length, Object.keys(ACCOLADES).length);
      for (const url of searches) {
        const term = new URL(url).searchParams.get('srsearch') ?? '';
        // Exactly one category clause, whichever operator the tier needs.
        assert.equal(term.match(/(incategory|deepcat):/g)?.length, 1, term);
      }
    });
  });

  it('asks for every tier there is, so adding one cannot forget to search it', () => {
    const { transport, urls } = recorder({});
    return collectCommonsPhotos(QUERY, transport).then(() => {
      const terms = urls
        .filter((u) => u.includes('srsearch'))
        .map((u) => new URL(u).searchParams.get('srsearch') ?? '');
      for (const { category } of Object.values(ACCOLADES)) {
        assert.ok(terms.some((t) => t.includes(category)), `never searched ${category}`);
      }
    });
  });

  it('keeps the best standing where a file carries more than one', async () => {
    // Most featured pictures are also quality images.
    const { transport } = recorder({
      featured: ['File:Both.jpg'],
      quality: ['File:Both.jpg', 'File:Only.jpg'],
    });
    const { photos } = await collectCommonsPhotos(QUERY, transport);
    const both = photos.find((p) => p.title === 'Both.jpg');
    const only = photos.find((p) => p.title === 'Only.jpg');
    assert.equal(both?.accolade, 'featured');
    assert.equal(only?.accolade, 'quality');
  });

  it('never asks for details on a mixed batch of tiers', async () => {
    // The tier is what the response gets stamped with, so a mixed batch loses it.
    const { transport, urls } = recorder({
      featured: ['File:F1.jpg', 'File:F2.jpg'],
      quality: ['File:Q1.jpg'],
    });
    await collectCommonsPhotos(QUERY, transport);
    const detailCalls = urls.filter((u) => u.includes('titles='));
    assert.ok(detailCalls.length >= 2, 'tiers were batched together');
    for (const url of detailCalls) {
      const titles = (new URL(url).searchParams.get('titles') ?? '').split('|');
      const prefixes = new Set(titles.map((t) => t.replace(/^File:(\w)\d.*/, '$1')));
      assert.equal(prefixes.size, 1, titles.join('|'));
    }
  });

  it('returns nothing, and asks for no details, when nowhere has anything', async () => {
    const { transport, urls } = recorder({});
    const { photos } = await collectCommonsPhotos(QUERY, transport);
    assert.deepEqual(photos, []);
    assert.equal(urls.filter((u) => u.includes('titles=')).length, 0);
  });

  it('survives one tier failing rather than losing the search', async () => {
    const { transport } = recorder({ featured: ['File:A.jpg'], quality: ['File:B.jpg'] });
    const flaky: JsonTransport = async (url) => {
      // Read the term rather than substring-matching the raw URL: URLSearchParams
      // encodes the space in "Quality images" as `+`, not `%20`, so the obvious
      // encodeURIComponent check silently never fires.
      const term = new URL(url).searchParams.get('srsearch') ?? '';
      if (term.includes(ACCOLADES.quality.category)) throw new Error('502');
      return transport(url);
    };
    const { photos } = await collectCommonsPhotos(QUERY, flaky);
    assert.deepEqual(photos.map((p) => p.title), ['A.jpg']);
  });

  it('sorts what it found by standing', async () => {
    const { transport } = recorder({
      valued: ['File:V.jpg'],
      quality: ['File:Q.jpg'],
      featured: ['File:F.jpg'],
    });
    const { photos } = await collectCommonsPhotos(QUERY, transport);
    assert.deepEqual(photos.map((p) => p.accolade), ['featured', 'quality', 'valued']);
  });

  it('reports every tier as answered when nothing failed, even if empty', async () => {
    const { transport } = recorder({ featured: ['File:A.jpg'] });
    const { tiers } = await collectCommonsPhotos(QUERY, transport);
    assert.deepEqual(
      tiers.map((t) => t.accolade).sort(),
      Object.keys(ACCOLADES).sort(),
    );
    assert.ok(
      tiers.every((t) => t.ok),
      'an empty tier is not the same as a failed one',
    );
  });

  it('marks a tier failed, not just thin, when its search request fails', async () => {
    // This is the bug the "valued" tier had — a broken query and an honestly
    // empty one both folded into `titles: []`, so nobody could tell them apart.
    const { transport } = recorder({ featured: ['File:A.jpg'], quality: ['File:B.jpg'] });
    const flaky: JsonTransport = async (url) => {
      const term = new URL(url).searchParams.get('srsearch') ?? '';
      if (term.includes(ACCOLADES.quality.category)) throw new Error('502');
      return transport(url);
    };
    const { tiers } = await collectCommonsPhotos(QUERY, flaky);
    assert.equal(tiers.find((t) => t.accolade === 'quality')?.ok, false);
    assert.equal(tiers.find((t) => t.accolade === 'featured')?.ok, true);
  });

  it('marks a tier failed when its search succeeds but the details call fails', async () => {
    // Titles were found; nothing about them could be confirmed. That is still
    // a tier the caller could not get an answer from.
    const { transport } = recorder({ quality: ['File:B.jpg'] });
    const flaky: JsonTransport = async (url) => {
      if (new URL(url).searchParams.get('titles')) throw new Error('502');
      return transport(url);
    };
    const { photos, tiers } = await collectCommonsPhotos(QUERY, flaky);
    assert.deepEqual(photos, []);
    assert.equal(tiers.find((t) => t.accolade === 'quality')?.ok, false);
  });

  it('passes the CORS opt-in through to every request it makes', async () => {
    // This is what the published build depends on: one missed URL and that call
    // fails opaquely while the others succeed, which looks like a thin result
    // rather than a broken one.
    const { transport, urls } = recorder({ featured: ['File:A.jpg'] });
    await collectCommonsPhotos(QUERY, transport, { cors: true });
    assert.ok(urls.length >= 4);
    for (const url of urls) {
      assert.equal(new URL(url).searchParams.get('origin'), '*', url);
    }
  });

  it('leaves the requests alone when nothing asked for CORS', async () => {
    const { transport, urls } = recorder({ featured: ['File:A.jpg'] });
    await collectCommonsPhotos(QUERY, transport);
    for (const url of urls) assert.equal(new URL(url).searchParams.get('origin'), null);
  });
});

describe('toHotspots', () => {
  it('groups photographs taken from the same place', async () => {
    const { transport } = recorder({ quality: ['File:A.jpg', 'File:B.jpg'] });
    const { photos } = await collectCommonsPhotos(QUERY, transport);
    const hotspots = toHotspots(photos);
    // Both fixtures sit on the same coordinate, so they are one spot.
    assert.equal(hotspots.length, 1);
    assert.equal(hotspots[0].count, 2);
    assert.ok(hotspots[0].spanM >= 0);
  });

  it('gives a spot the same id however the photographs arrived', async () => {
    const forwards = recorder({ quality: ['File:A.jpg', 'File:B.jpg'] });
    const backwards = recorder({ quality: ['File:B.jpg', 'File:A.jpg'] });
    const a = toHotspots((await collectCommonsPhotos(QUERY, forwards.transport)).photos);
    const b = toHotspots((await collectCommonsPhotos(QUERY, backwards.transport)).photos);
    assert.equal(a[0].id, b[0].id);
  });

  it('is empty for nothing, rather than one empty spot', () => {
    assert.deepEqual(toHotspots([]), []);
  });
});
