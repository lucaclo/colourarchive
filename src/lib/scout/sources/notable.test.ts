import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  attachNotableByAuthor,
  notableCommonsSearchUrl,
  notableFlickrSearchUrl,
  readNotablePhotographers,
  tagNotable,
  type NotablePhotographer,
} from './notable.ts';
import type { RawPhoto } from './types.ts';

const CENTRE = { lat: 55.9533, lon: -3.1883 };
const QUERY = { centre: CENTRE, radiusM: 5000, limit: 10 };

const LANGE: NotablePhotographer = {
  name: 'Dorothea Lange',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/Dorothea_Lange',
};

const photo = (over: Partial<RawPhoto> = {}): RawPhoto => ({
  id: 'x',
  source: 'wikimedia',
  at: CENTRE,
  originUrl: 'x',
  thumbUrl: 'x',
  thumbWidth: 1,
  thumbHeight: 1,
  title: 't',
  author: 'A Photographer',
  licence: { name: 'l' },
  ...over,
});

describe('notableCommonsSearchUrl', () => {
  it('defaults the category to "Photographs by <name>"', () => {
    const term = new URL(notableCommonsSearchUrl(QUERY, LANGE)).searchParams.get('srsearch');
    assert.match(term ?? '', /deepcat:"Photographs by Dorothea Lange"/);
  });

  it('uses an explicit category instead, when the default guess would be wrong', () => {
    const overridden: NotablePhotographer = { name: 'X', commonsCategory: 'Photographs by X Y' };
    const term = new URL(notableCommonsSearchUrl(QUERY, overridden)).searchParams.get('srsearch');
    assert.match(term ?? '', /deepcat:"Photographs by X Y"/);
  });

  it('always walks subcategories, unlike the fixed-convention accolade tiers', () => {
    const term = new URL(notableCommonsSearchUrl(QUERY, LANGE)).searchParams.get('srsearch');
    assert.doesNotMatch(term ?? '', /incategory:/);
  });
});

describe('notableFlickrSearchUrl', () => {
  it('is null for a photographer with no known Flickr identity', () => {
    assert.equal(notableFlickrSearchUrl(QUERY, LANGE, 'KEY'), null);
  });

  it('scopes to the user id when one is known', () => {
    const withFlickr: NotablePhotographer = { ...LANGE, flickrNsid: '99@N00' };
    const url = new URL(notableFlickrSearchUrl(QUERY, withFlickr, 'KEY') ?? '');
    assert.equal(url.searchParams.get('user_id'), '99@N00');
  });
});

describe('tagNotable', () => {
  it('stamps every photo with the photographer that was searched for', () => {
    const [tagged] = tagNotable([photo()], LANGE);
    assert.deepEqual(tagged.notable, { name: 'Dorothea Lange', wikipediaUrl: LANGE.wikipediaUrl });
  });
});

describe('attachNotableByAuthor', () => {
  it('matches a general-search result whose author is on the list', () => {
    const [tagged] = attachNotableByAuthor([photo({ author: 'Dorothea Lange' })], [LANGE]);
    assert.equal(tagged.notable?.name, 'Dorothea Lange');
  });

  it('matches regardless of case', () => {
    const [tagged] = attachNotableByAuthor([photo({ author: 'dorothea lange' })], [LANGE]);
    assert.equal(tagged.notable?.name, 'Dorothea Lange');
  });

  it('leaves an unrelated author untouched', () => {
    const [untouched] = attachNotableByAuthor([photo({ author: 'Someone Else' })], [LANGE]);
    assert.equal(untouched.notable, undefined);
  });

  it('never overwrites an existing, more confident tag', () => {
    const already = photo({ author: 'Someone Else', notable: { name: 'Already Tagged' } });
    const [unchanged] = attachNotableByAuthor([already], [LANGE]);
    assert.equal(unchanged.notable?.name, 'Already Tagged');
  });

  it('is a no-op with an empty list', () => {
    const photos = [photo()];
    assert.equal(attachNotableByAuthor(photos, []), photos);
  });
});

describe('readNotablePhotographers', () => {
  it('reads the real curated list and finds the seeded FSA photographers', async () => {
    const list = await readNotablePhotographers();
    assert.ok(list.length > 0);
    assert.ok(list.some((p) => p.name === 'Dorothea Lange'));
    for (const p of list) assert.ok(p.name.trim().length > 0, 'every entry has a real name');
  });
});
