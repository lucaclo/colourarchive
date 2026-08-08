import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readSession, writeSession, type SessionState } from './session.ts';
import { defaultLens, defaultShown, defaultSlab, defaultTarget } from './state.ts';

const aSession = (): SessionState => ({
  centre: { lat: 55.9533, lon: -3.1883 },
  label: { name: 'Calton Hill', detail: 'Edinburgh' },
  radiusKm: 10,
  timeZone: 'Europe/London',
  view: '3d',
  basemap: 'satellite',
  shown: defaultShown(),
  slab: defaultSlab(),
  lens: defaultLens(),
  target: defaultTarget(),
  isoDate: '2026-08-05',
});

describe('reading a stored session', () => {
  it('comes back as what went in', () => {
    const state = aSession();
    const back = readSession(writeSession(state));
    assert.deepEqual(back.centre, state.centre);
    assert.deepEqual(back.label, state.label);
    assert.deepEqual(back.shown, state.shown);
    assert.deepEqual(back.slab, state.slab);
    assert.deepEqual(back.lens, state.lens);
    assert.deepEqual(back.target, state.target);
    assert.equal(back.radiusKm, state.radiusKm);
    assert.equal(back.timeZone, state.timeZone);
    assert.equal(back.isoDate, state.isoDate);
    assert.equal(back.view, '3d');
    assert.equal(back.basemap, 'satellite');
  });

  it('opens flat and on paper when there is nothing stored', () => {
    for (const nothing of [null, '', 'null']) {
      const back = readSession(nothing);
      assert.equal(back.view, '2d');
      assert.equal(back.basemap, 'light');
      assert.equal(back.centre, undefined, 'nothing stored is not a place');
    }
  });

  it('keeps the three basemaps it knows and refuses the rest', () => {
    for (const basemap of ['light', 'dark', 'satellite'] as const) {
      assert.equal(readSession(JSON.stringify({ basemap })).basemap, basemap);
    }
    // An old build's name, or a corrupted one. Falling back to light is what
    // makes it recoverable: it is the style the map is already constructed with.
    for (const nonsense of ['terrain', '', 0, null, {}, ['dark']]) {
      assert.equal(readSession(JSON.stringify({ basemap: nonsense })).basemap, 'light');
    }
  });

  it('treats anything that is not 3d as flat', () => {
    assert.equal(readSession(JSON.stringify({ view: '3d' })).view, '3d');
    for (const nonsense of ['2d', '2D', 'globe', true, null, 3]) {
      assert.equal(readSession(JSON.stringify({ view: nonsense })).view, '2d');
    }
  });

  it('throws on a session it cannot read, rather than half-applying one', () => {
    // The caller abandons the restore on this. A page holding somebody's
    // toggles but not their coordinate is worse than one that opens fresh.
    assert.throws(() => readSession('{ not json'));
    assert.throws(() => readSession('{"centre":'));
  });

  it('leaves a partial session partial, for the caller to merge over defaults', () => {
    // A session written before a toggle existed simply does not carry it, and
    // must not come back as a false: the layer would silently be off.
    const back = readSession(JSON.stringify({ shown: { photos: false } }));
    assert.deepEqual(back.shown, { photos: false });
    assert.equal(back.slab, undefined);
    assert.equal(back.lens, undefined);
  });
});

describe('writing a session', () => {
  it('carries every field the restore reads back', () => {
    const written = JSON.parse(writeSession(aSession()));
    assert.deepEqual(
      Object.keys(written).sort(),
      [
        'basemap',
        'centre',
        'isoDate',
        'label',
        'lens',
        'radiusKm',
        'shown',
        'slab',
        'target',
        'timeZone',
        'view',
      ],
      'a field written but not read, or read but not written, is a half restore',
    );
  });

  it('is JSON, so a browser that refuses to store it fails at the write', () => {
    assert.doesNotThrow(() => JSON.parse(writeSession(aSession())));
  });
});
