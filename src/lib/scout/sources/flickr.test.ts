import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FlickrError, flickrSearchUrl, hasFlickrKey, parseFlickrSearch } from './flickr.ts';

const CENTRE = { lat: 55.9533, lon: -3.1883 };
const QUERY = { centre: CENTRE, radiusM: 2000, limit: 50 };

const entry = (over: Record<string, unknown> = {}) => ({
  id: '123456',
  owner: '12345678@N00',
  ownername: 'A Photographer',
  title: 'Calton Hill at dawn',
  latitude: '55.9553',
  longitude: '-3.1828',
  license: '4',
  datetaken: '2020-06-21 07:15:00',
  url_n: 'https://live.staticflickr.com/123/123456_a_n.jpg',
  width_n: '320',
  height_n: '213',
  ...over,
});

describe('flickrSearchUrl', () => {
  it('asks for a geo-scoped, interestingness-sorted search', () => {
    const url = new URL(flickrSearchUrl(QUERY, 'KEY123'));
    assert.equal(url.searchParams.get('method'), 'flickr.photos.search');
    assert.equal(url.searchParams.get('lat'), '55.9533');
    assert.equal(url.searchParams.get('lon'), '-3.1883');
    assert.equal(url.searchParams.get('radius_units'), 'km');
    assert.equal(url.searchParams.get('sort'), 'interestingness-desc');
    assert.equal(url.searchParams.get('api_key'), 'KEY123');
  });

  it('converts the radius from metres to Flickr\'s kilometres', () => {
    const url = new URL(flickrSearchUrl({ ...QUERY, radiusM: 5000 }, 'KEY123'));
    assert.equal(url.searchParams.get('radius'), '5.00');
  });

  it('clamps the radius to what Flickr will actually accept', () => {
    const tiny = new URL(flickrSearchUrl({ ...QUERY, radiusM: 1 }, 'KEY123'));
    assert.equal(tiny.searchParams.get('radius'), '0.10');
    const huge = new URL(flickrSearchUrl({ ...QUERY, radiusM: 200_000 }, 'KEY123'));
    assert.equal(huge.searchParams.get('radius'), '32.00');
  });

  it('scopes to one photographer when asked, without dropping the geo filter', () => {
    const url = new URL(flickrSearchUrl(QUERY, 'KEY123', { userId: '99@N00' }));
    assert.equal(url.searchParams.get('user_id'), '99@N00');
    assert.equal(url.searchParams.get('lat'), '55.9533', 'geo filter stays alongside user_id');
  });

  it('asks for JSON without the padding callback', () => {
    const url = new URL(flickrSearchUrl(QUERY, 'KEY123'));
    assert.equal(url.searchParams.get('format'), 'json');
    assert.equal(url.searchParams.get('nojsoncallback'), '1');
  });
});

describe('parseFlickrSearch', () => {
  it('reads a whole photograph, attribution included', () => {
    const [photo] = parseFlickrSearch({ photos: { photo: [entry()] } });
    assert.equal(photo.title, 'Calton Hill at dawn');
    assert.equal(photo.author, 'A Photographer');
    assert.equal(photo.source, 'flickr');
    assert.deepEqual(photo.at, { lat: 55.9553, lon: -3.1828 });
    assert.equal(photo.originUrl, 'https://www.flickr.com/photos/12345678@N00/123456/');
  });

  it('maps a licence id to its real name, restrictive or not', () => {
    const [allRightsReserved] = parseFlickrSearch({ photos: { photo: [entry({ license: '0' })] } });
    assert.equal(allRightsReserved.licence.name, 'All Rights Reserved');
    assert.equal(allRightsReserved.licence.url, undefined);

    const [ccBy] = parseFlickrSearch({ photos: { photo: [entry({ license: '4' })] } });
    assert.equal(ccBy.licence.name, 'CC BY 2.0');
    assert.match(ccBy.licence.url ?? '', /creativecommons\.org\/licenses\/by\/2\.0/);
  });

  it('never invents a bearing', () => {
    const [photo] = parseFlickrSearch({ photos: { photo: [entry()] } });
    assert.equal(photo.bearing, undefined);
  });

  it('drops a photo with no owner name rather than showing it anonymously', () => {
    assert.deepEqual(parseFlickrSearch({ photos: { photo: [entry({ ownername: '' })] } }), []);
  });

  it('drops a photo at Null Island — no real geotag, not a real position', () => {
    assert.deepEqual(
      parseFlickrSearch({ photos: { photo: [entry({ latitude: '0', longitude: '0' })] } }),
      [],
    );
  });

  it('drops a photo with an out-of-range position', () => {
    assert.deepEqual(
      parseFlickrSearch({ photos: { photo: [entry({ latitude: '999', longitude: '0' })] } }),
      [],
    );
  });

  it('falls back to the medium size when the small one was never generated', () => {
    const [photo] = parseFlickrSearch({
      photos: {
        photo: [entry({ url_n: undefined, width_n: undefined, height_n: undefined, url_m: 'https://x/m.jpg', width_m: '500', height_m: '333' })],
      },
    });
    assert.equal(photo.thumbUrl, 'https://x/m.jpg');
    assert.equal(photo.thumbWidth, 500);
  });

  it('leaves an unreadable date undefined instead of guessing', () => {
    for (const value of ['', 'not a date', '1990-01-01 00:00:00']) {
      const [photo] = parseFlickrSearch({ photos: { photo: [entry({ datetaken: value })] } });
      assert.equal(photo?.takenAt, undefined, value);
    }
  });

  it('throws with Flickr\'s own message when the call itself failed', () => {
    assert.throws(
      () => parseFlickrSearch({ stat: 'fail', code: 100, message: 'Invalid API Key' }),
      (err: unknown) => err instanceof FlickrError && err.message === 'Invalid API Key',
    );
  });

  it('survives a response with no photos at all', () => {
    assert.deepEqual(parseFlickrSearch({}), []);
    assert.deepEqual(parseFlickrSearch({ photos: { photo: [] } }), []);
  });
});

describe('hasFlickrKey', () => {
  it('reads the key fresh, not from a first-import snapshot', () => {
    const before = process.env.FLICKR_API_KEY;
    try {
      delete process.env.FLICKR_API_KEY;
      assert.equal(hasFlickrKey(), false);
      process.env.FLICKR_API_KEY = 'x';
      assert.equal(hasFlickrKey(), true);
      process.env.FLICKR_API_KEY = '   ';
      assert.equal(hasFlickrKey(), false, 'whitespace-only is not a key');
    } finally {
      if (before === undefined) delete process.env.FLICKR_API_KEY;
      else process.env.FLICKR_API_KEY = before;
    }
  });
});
