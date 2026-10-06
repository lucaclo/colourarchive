import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLatLon, mineFeatures, parsePlacedLocations, resolveMinePhotos, type MineChapterInput } from './mine.ts';

const photo = (id: string, exif: MineChapterInput['photos'][number]['exif'] = {}) => ({
  id,
  placeholder: 'data:,',
  derivatives: [
    { width: 1280, avif: `/img/${id}-1280.avif` },
    { width: 640, avif: `/img/${id}-640.avif` },
  ],
  exif,
});
const chapter = (photos: MineChapterInput['photos']): MineChapterInput => ({ name: 'Blue', colour: 'oklch(0.5 0.1 240)', photos });

describe('isLatLon', () => {
  it('accepts a real coordinate, including the edges', () => {
    assert.equal(isLatLon({ lat: 51.5, lon: -0.12 }), true);
    assert.equal(isLatLon({ lat: -90, lon: 180 }), true);
  });
  it('refuses out-of-range, non-finite and non-numeric values', () => {
    assert.equal(isLatLon({ lat: 91, lon: 0 }), false);
    assert.equal(isLatLon({ lat: 0, lon: -180.1 }), false);
    assert.equal(isLatLon({ lat: NaN, lon: 0 }), false);
    assert.equal(isLatLon({ lat: '51', lon: 0 }), false);
    assert.equal(isLatLon(null), false);
  });
});

describe('parsePlacedLocations', () => {
  it('keeps valid entries and drops the rest without failing', () => {
    const parsed = parsePlacedLocations({ a: { lat: 1, lon: 2, extra: true }, b: { lat: 200, lon: 0 }, c: 'x' });
    assert.deepEqual(parsed, { a: { lat: 1, lon: 2 } });
  });
  it('reads anything that is not an object as no placements', () => {
    assert.deepEqual(parsePlacedLocations(null), {});
    assert.deepEqual(parsePlacedLocations([{ lat: 1, lon: 2 }]), {});
  });
});

describe('resolveMinePhotos', () => {
  it('uses the smallest derivative as the thumbnail', () => {
    const [mine] = resolveMinePhotos([chapter([photo('p')])], {});
    assert.equal(mine.thumb, '/img/p-640.avif');
  });
  it('leaves a photo with neither source unlocated, but still lists it', () => {
    const [mine] = resolveMinePhotos([chapter([photo('p')])], {});
    assert.equal(mine.lat, undefined);
    assert.equal(mine.source, undefined);
  });
  it('pins a photo from its GPS when nothing was placed', () => {
    const [mine] = resolveMinePhotos([chapter([photo('p', { location: { lat: 10, lon: 20 } })])], {});
    assert.deepEqual([mine.lat, mine.lon, mine.source], [10, 20, 'gps']);
  });
  it('a hand placement wins over GPS', () => {
    const [mine] = resolveMinePhotos(
      [chapter([photo('p', { location: { lat: 10, lon: 20 } })])],
      { p: { lat: 1, lon: 2 } },
    );
    assert.deepEqual([mine.lat, mine.lon, mine.source], [1, 2, 'placed']);
  });
  it('ignores a malformed GPS position rather than pinning it at 0,0', () => {
    const [mine] = resolveMinePhotos([chapter([photo('p', { location: { lat: NaN, lon: 0 } })])], {});
    assert.equal(mine.lat, undefined);
  });
  it('skips a photo with no derivative, since there is nothing to draw', () => {
    const bare = { ...photo('p'), derivatives: [] };
    assert.deepEqual(resolveMinePhotos([chapter([bare])], {}), []);
  });
});

describe('mineFeatures', () => {
  it('emits only located photos, each carrying its index in the full list', () => {
    const photos = resolveMinePhotos([chapter([photo('a'), photo('b')])], { b: { lat: 3, lon: 4 } });
    const { features } = mineFeatures(photos);
    assert.equal(features.length, 1);
    assert.deepEqual(features[0].geometry.coordinates, [4, 3]);
    assert.deepEqual(features[0].properties, { id: 'b', order: 1 });
  });
});
