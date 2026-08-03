import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SPOTS,
  addSpot,
  indexOfSpot,
  readSpot,
  readSpots,
  removeSpot,
  type SavedSpot,
} from './spots.ts';

const spot = (name: string, lat = 55.9532, lon = -3.1883, savedAt = 1): SavedSpot => ({
  name,
  lat,
  lon,
  savedAt,
});

describe('readSpot', () => {
  it('takes a whole entry', () => {
    const read = readSpot({
      name: 'Calton Hill',
      lat: 55.9553,
      lon: -3.1828,
      timeZone: 'Europe/London',
      radiusKm: 8,
      savedAt: 1234,
    })!;
    assert.equal(read.name, 'Calton Hill');
    assert.equal(read.timeZone, 'Europe/London');
    assert.equal(read.radiusKm, 8);
    assert.equal(read.savedAt, 1234);
  });

  it('refuses an entry with nothing to go on', () => {
    assert.equal(readSpot(null), null);
    assert.equal(readSpot('Calton Hill'), null);
    assert.equal(readSpot({ lat: 55.9, lon: -3.1 }), null, 'a spot with no name');
    assert.equal(readSpot({ name: '   ', lat: 55.9, lon: -3.1 }), null);
    assert.equal(readSpot({ name: 'Nowhere', lat: 'x', lon: -3.1 }), null);
    assert.equal(readSpot({ name: 'The pole', lat: 89, lon: 0 }), null, 'mercator cannot draw it');
  });

  it('drops a field that fails checking without losing the spot', () => {
    const read = readSpot({ name: 'Somewhere', lat: 1, lon: 2, radiusKm: 900 })!;
    assert.equal(read.name, 'Somewhere');
    assert.equal(read.radiusKm, undefined);
  });
});

describe('readSpots', () => {
  it('is empty rather than broken when there is nothing, or nonsense', () => {
    assert.deepEqual(readSpots(null), []);
    assert.deepEqual(readSpots(''), []);
    assert.deepEqual(readSpots('{ not json'), []);
    assert.deepEqual(readSpots('{"spots":[]}'), [], 'an object is not a list');
  });

  it('loses only the bad entry, never the good ones alongside it', () => {
    const stored = JSON.stringify([
      { name: 'Good', lat: 1, lon: 2, savedAt: 5 },
      { lat: 3, lon: 4, savedAt: 6 },
      'rubbish',
      { name: 'Also good', lat: 5, lon: 6, savedAt: 7 },
    ]);
    const read = readSpots(stored);
    assert.deepEqual(read.map((s) => s.name), ['Also good', 'Good']);
  });

  it('gives them back newest first', () => {
    const stored = JSON.stringify([spot('old', 1, 1, 100), spot('new', 2, 2, 300), spot('mid', 3, 3, 200)]);
    assert.deepEqual(readSpots(stored).map((s) => s.name), ['new', 'mid', 'old']);
  });

  it('will not hand back more than the list is meant to hold', () => {
    const many = Array.from({ length: MAX_SPOTS + 10 }, (_, i) => spot(`s${i}`, i / 10, 0, i));
    assert.equal(readSpots(JSON.stringify(many)).length, MAX_SPOTS);
  });
});

describe('addSpot', () => {
  it('puts the newest at the front', () => {
    const list = addSpot(addSpot([], spot('first', 1, 1)), spot('second', 2, 2));
    assert.deepEqual(list.map((s) => s.name), ['second', 'first']);
  });

  it('treats a spot fifty metres away as the same one, and renames it', () => {
    // Searching and then dragging the pin lands a few metres off. Two entries
    // that look identical and are not would be worse than useless.
    const original = spot('Calton Hill', 55.9553, -3.1828);
    const nudged = { ...spot('Calton Hill, Edinburgh', 55.95533, -3.18284), savedAt: 2 };
    const list = addSpot([original], nudged);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Calton Hill, Edinburgh', 'the newer name wins');
  });

  it('keeps a genuinely different spot separate', () => {
    // ~1.1 km north: a different place by any reading.
    const list = addSpot([spot('Calton Hill', 55.9553, -3.1828)], spot('Leith', 55.9653, -3.1828, 2));
    assert.equal(list.length, 2);
  });

  it('drops the oldest once it is full', () => {
    let list: SavedSpot[] = [];
    for (let i = 0; i < MAX_SPOTS + 5; i++) list = addSpot(list, spot(`s${i}`, i / 10, 0, i));
    assert.equal(list.length, MAX_SPOTS);
    assert.equal(list[0].name, `s${MAX_SPOTS + 4}`);
    assert.ok(!list.some((s) => s.name === 's0'), 'the oldest is gone');
  });
});

describe('removeSpot and indexOfSpot', () => {
  it('finds and removes by position, not by name', () => {
    const list = [spot('A', 10, 10), spot('B', 20, 20)];
    assert.equal(indexOfSpot(list, { lat: 20.0001, lon: 20.0001 }), 1);
    assert.deepEqual(removeSpot(list, { lat: 20, lon: 20 }).map((s) => s.name), ['A']);
  });

  it('leaves the list alone when the spot is not in it', () => {
    const list = [spot('A', 10, 10)];
    assert.equal(indexOfSpot(list, { lat: 40, lon: 40 }), -1);
    assert.equal(removeSpot(list, { lat: 40, lon: 40 }), list);
  });
});
