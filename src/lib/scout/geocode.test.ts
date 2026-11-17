import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// geocode.ts sweeps its disk cache when it loads, so point paths.ts at a
// private data root first: the test never touches the real cache.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geocode-'));
process.env.COLOUR_ARCHIVE_DATA = root;
const { dedupePlaces, placeKind } = await import('./geocode');
type Place = Parameters<typeof dedupePlaces>[0][number];

after(() => fs.rm(root, { recursive: true, force: true }));

const place = (over: Partial<Place>): Place => ({
  name: 'Brighton Pier',
  detail: 'Lower Esplanade, Kemptown, Brighton',
  lat: 50.8168041,
  lon: -0.1368256,
  kind: 'Pier',
  timeZone: 'Europe/London',
  ...over,
});

test('the same name at the same coordinate is listed once, the first kept', () => {
  const first = place({});
  const again = place({ lat: first.lat + 0.00009, lon: first.lon - 0.0001, kind: '' });
  assert.deepEqual(dedupePlaces([first, again]), [first]);
});

test('a second point inside the first one’s bounds, same name and address, is the same place', () => {
  // What Nominatim gives for "Brighton pier": the pier, then a point on it.
  const pier = place({ bounds: [-0.1377919, 50.8144946, -0.1362925, 50.8191287] });
  const point = place({ lat: 50.8152357, lon: -0.1370512, bounds: [-0.1371012, 50.8151857, -0.1370012, 50.8152857] });
  assert.deepEqual(dedupePlaces([pier, point]), [pier]);
});

test('different places stay apart', () => {
  const pier = place({ bounds: [-0.1377919, 50.8144946, -0.1362925, 50.8191287] });
  // Same name further off, a different name close by, and same name inside the
  // bounds but at another address.
  const elsewhere = place({ lat: 50.9, lon: -0.2 });
  const other = place({ name: 'Palace Pier Fish Bar', lat: pier.lat, lon: pier.lon });
  const otherAddress = place({ lat: 50.8152357, lon: -0.1370512, detail: 'Madeira Drive, Brighton' });
  assert.equal(dedupePlaces([pier, elsewhere, other, otherAddress]).length, 4);
});

test('OSM classes become plain words, never "man made"', () => {
  assert.equal(placeKind('man_made', 'pier', 'man_made'), 'Pier');
  assert.equal(placeKind('tourism', 'attraction', 'tourism'), 'Attraction');
  assert.equal(placeKind('highway', 'residential', 'road'), 'Street');
  assert.equal(placeKind('amenity', 'cafe', 'amenity'), 'Cafe');
  assert.equal(placeKind('amenity', 'place_of_worship', 'amenity'), 'Place of worship');
  assert.equal(placeKind('boundary', 'administrative', 'city'), 'City');
  assert.equal(placeKind('natural', 'peak', 'peak'), 'Peak');
});

test('a class with no plain word gets no label', () => {
  assert.equal(placeKind('man_made', 'works', 'man_made'), '');
  assert.equal(placeKind('building', 'yes', 'building'), '');
  assert.equal(placeKind(), '');
});
