import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHIVE_CREDIT, ARCHIVE_SOURCE, parseSharedFeed, sharedNear } from './archive';
import { toHotspots } from './photo-client';

const zermatt = { lat: 46.0207, lon: 7.7491 };
const photo = (over: Record<string, unknown> = {}) => ({
  id: 'abc123', lat: 46.021, lon: 7.749, thumb: '/img/abc-480.avif', thumbWidth: 480, thumbHeight: 320,
  title: 'Landscape photograph, Blue, February 2023', takenAt: '2023-02-17T13:05:18.000Z', ...over,
});

test('a feed is checked, not trusted', () => {
  const feed = parseSharedFeed({
    credit: 'Colour Archive',
    photos: [photo(), photo({ id: '../etc' }), photo({ lat: 200 }), photo({ thumb: 'https://evil.example/x.jpg' }), null],
  });
  assert.equal(feed.photos.length, 1);
  assert.deepEqual(parseSharedFeed('nope'), { credit: ARCHIVE_CREDIT, photos: [] });
});

test('shared photos near the pin become hotspot photographs, credited and linked', () => {
  const feed = parseSharedFeed({ photos: [photo(), photo({ id: 'far', lat: 47.5 })] });
  const near = sharedNear(feed, zermatt, 2000);
  assert.equal(near.length, 1);
  const p = near[0];
  assert.equal(p.source, ARCHIVE_SOURCE);
  assert.equal(p.author, 'Colour Archive');
  assert.equal(p.originUrl, '/#photo=abc123');
  assert.equal(p.licence.name, 'All rights reserved');
  assert.equal(p.takenAt?.toISOString(), '2023-02-17T13:05:18.000Z');
});

test('they cluster with everyone else’s photographs at the same spot', () => {
  const ours = sharedNear(parseSharedFeed({ photos: [photo()] }), zermatt, 2000)[0];
  const theirs = { ...ours, id: '99', source: 'wikimedia', author: 'Someone', at: { lat: 46.02101, lon: 7.74901 } };
  const spots = toHotspots([theirs, ours]);
  assert.equal(spots.length, 1);
  assert.equal(spots[0].count, 2);
});
