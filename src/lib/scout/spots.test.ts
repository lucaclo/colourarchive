import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NOTE,
  MAX_OUTCOME,
  MAX_PHOTOS,
  MAX_SPOTS,
  MAX_VISITS,
  addSpot,
  addVisit,
  closestVisit,
  describeFrame,
  formatVisitDate,
  indexOfSpot,
  readFrame,
  readPhoto,
  readSpot,
  readSpots,
  readVisit,
  removeSpot,
  updateSpot,
  type SavedSpot,
  type SpotVisit,
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

const PLACE = { name: 'Calton Hill', lat: 55.9553, lon: -3.1823, savedAt: 1 };
const FRAME = {
  sensor: 'ff',
  focalLengthMm: 24,
  orientation: 'landscape' as const,
  bearing: 270,
  tiltDeg: 4,
};

describe('the notebook fields', () => {
  it('keeps a note, a frame, a monolith height and photographs', () => {
    const spot = readSpot({
      ...PLACE,
      note: 'Arrive before the gate closes.',
      frame: FRAME,
      slabHeightM: 42,
      photos: [{ url: 'https://example.org/a.jpg', credit: 'A. Photographer', source: 'wikimedia' }],
    });
    assert.equal(spot?.note, 'Arrive before the gate closes.');
    assert.deepEqual(spot?.frame, FRAME);
    assert.equal(spot?.slabHeightM, 42);
    assert.equal(spot?.photos?.length, 1);
    assert.equal(spot?.photos?.[0].credit, 'A. Photographer');
  });

  it('drops a bad notebook field without losing the place', () => {
    const spot = readSpot({
      ...PLACE,
      note: { not: 'a string' },
      frame: { ...FRAME, bearing: 'north' },
      slabHeightM: -5,
      photos: 'not a list',
    });
    assert.equal(spot?.name, 'Calton Hill');
    assert.equal(spot?.note, undefined);
    assert.equal(spot?.frame, undefined);
    assert.equal(spot?.slabHeightM, undefined);
    assert.equal(spot?.photos, undefined);
  });

  it('truncates a note rather than refusing it', () => {
    const spot = readSpot({ ...PLACE, note: 'x'.repeat(MAX_NOTE + 500) });
    assert.equal(spot?.note?.length, MAX_NOTE);
  });

  it('caps the photographs a spot may carry', () => {
    const many = Array.from({ length: MAX_PHOTOS + 4 }, (_, i) => ({
      url: `https://example.org/${i}.jpg`,
    }));
    assert.equal(readSpot({ ...PLACE, photos: many })?.photos?.length, MAX_PHOTOS);
  });
});

describe('readFrame', () => {
  it('normalises a bearing past the compass rather than refusing it', () => {
    assert.equal(readFrame({ ...FRAME, bearing: 370 })?.bearing, 10);
    assert.equal(readFrame({ ...FRAME, bearing: -90 })?.bearing, 270);
  });

  it('refuses a frame missing any part of the aim', () => {
    for (const bad of [
      { ...FRAME, sensor: '' },
      { ...FRAME, focalLengthMm: 0 },
      { ...FRAME, focalLengthMm: 5000 },
      { ...FRAME, orientation: 'square' },
      { ...FRAME, tiltDeg: 120 },
      { ...FRAME, bearing: Number.NaN },
    ]) {
      assert.equal(readFrame(bad), null, JSON.stringify(bad));
    }
  });
});

describe('readPhoto', () => {
  it('accepts only http and https, so a stored URL cannot become script', () => {
    assert.ok(readPhoto({ url: 'https://example.org/a.jpg' }));
    assert.ok(readPhoto({ url: 'http://example.org/a.jpg' }));
    for (const url of [
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      'file:///etc/passwd',
      '/relative/path.jpg',
      'example.org/a.jpg',
    ]) {
      assert.equal(readPhoto({ url }), null, url);
    }
  });

  it('keeps the credit it arrived with', () => {
    const photo = readPhoto({
      url: 'https://example.org/a.jpg',
      credit: 'A. Photographer',
      licence: 'CC BY-SA 4.0',
      source: 'wikimedia',
    });
    assert.equal(photo?.licence, 'CC BY-SA 4.0');
    assert.equal(photo?.source, 'wikimedia');
  });
});

describe('addSpot and the notebook', () => {
  it('carries the note and frame across a re-save that says nothing about them', () => {
    const kept = addSpot([], { ...PLACE, note: 'Gate closes at dusk.', frame: FRAME });
    const again = addSpot(kept, { ...PLACE, name: 'Calton Hill, Edinburgh', savedAt: 2 });
    assert.equal(again[0].name, 'Calton Hill, Edinburgh');
    assert.equal(again[0].note, 'Gate closes at dusk.');
    assert.deepEqual(again[0].frame, FRAME);
  });

  it('lets a re-save that does carry a note win', () => {
    const kept = addSpot([], { ...PLACE, note: 'old' });
    assert.equal(addSpot(kept, { ...PLACE, note: 'new', savedAt: 2 })[0].note, 'new');
  });
});

describe('updateSpot', () => {
  it('edits in place without reordering the list', () => {
    const list = [
      { ...PLACE, savedAt: 3 },
      { name: 'Arthur’s Seat', lat: 55.944, lon: -3.1618, savedAt: 2 },
    ];
    const next = updateSpot(list, { lat: 55.944, lon: -3.1618 }, { note: 'Windy.' });
    assert.equal(next[1].note, 'Windy.');
    assert.equal(next[0].name, 'Calton Hill', 'the order moved');
  });

  it('leaves the list alone when nothing there matches', () => {
    const list = [PLACE];
    assert.equal(updateSpot(list, { lat: 0, lon: 0 }, { note: 'nowhere' }), list);
  });
});

describe('readVisit', () => {
  const VISIT = { at: 1_700_000_000_000, sunAltitude: 12.5, sunAzimuth: 250 };

  it('takes a whole visit', () => {
    const visit = readVisit({
      ...VISIT,
      moonFraction: 0.4,
      cloud: 'broken cloud, mostly low',
      weather: 'Partly cloudy',
      outcome: 'The core cleared just after midnight.',
    });
    assert.deepEqual(visit, {
      at: VISIT.at,
      sunAltitude: 12.5,
      sunAzimuth: 250,
      moonFraction: 0.4,
      cloud: 'broken cloud, mostly low',
      weather: 'Partly cloudy',
      outcome: 'The core cleared just after midnight.',
    });
  });

  it('refuses a visit with no timestamp or no sun position', () => {
    assert.equal(readVisit(null), null);
    assert.equal(readVisit({ sunAltitude: 10, sunAzimuth: 200 }), null, 'no `at`');
    assert.equal(readVisit({ at: VISIT.at, sunAzimuth: 200 }), null, 'no altitude');
    assert.equal(readVisit({ at: VISIT.at, sunAltitude: 10 }), null, 'no azimuth');
    assert.equal(readVisit({ at: VISIT.at, sunAltitude: 95, sunAzimuth: 200 }), null, 'impossible altitude');
  });

  it('normalises azimuth past the compass rather than refusing it', () => {
    assert.equal(readVisit({ ...VISIT, sunAzimuth: 370 })?.sunAzimuth, 10);
  });

  it('drops an optional field that fails checking without losing the visit', () => {
    const visit = readVisit({ ...VISIT, moonFraction: 4, cloud: 123, outcome: { not: 'text' } });
    assert.equal(visit?.sunAltitude, 12.5);
    assert.equal(visit?.moonFraction, undefined);
    assert.equal(visit?.cloud, undefined);
    assert.equal(visit?.outcome, undefined);
  });

  it('truncates an outcome rather than refusing it', () => {
    const visit = readVisit({ ...VISIT, outcome: 'x'.repeat(MAX_OUTCOME + 500) });
    assert.equal(visit?.outcome?.length, MAX_OUTCOME);
  });
});

describe('readSpot with visits', () => {
  const VISIT = { at: 1_700_000_000_000, sunAltitude: 12.5, sunAzimuth: 250 };

  it('keeps a list of visits, newest first', () => {
    const spot = readSpot({
      ...PLACE,
      visits: [
        { ...VISIT, at: 1, sunAltitude: 1 },
        { ...VISIT, at: 3, sunAltitude: 3 },
        { ...VISIT, at: 2, sunAltitude: 2 },
      ],
    });
    assert.deepEqual(spot?.visits?.map((v) => v.at), [3, 2, 1]);
  });

  it('drops a bad visit without losing the place or the good ones', () => {
    const spot = readSpot({ ...PLACE, visits: [VISIT, 'rubbish', { at: 2 }] });
    assert.equal(spot?.name, 'Calton Hill');
    assert.equal(spot?.visits?.length, 1);
  });

  it('caps the visits a spot may carry', () => {
    const many = Array.from({ length: MAX_VISITS + 5 }, (_, i) => ({ ...VISIT, at: i + 1 }));
    assert.equal(readSpot({ ...PLACE, visits: many })?.visits?.length, MAX_VISITS);
  });

  it('carries visits across a re-save that says nothing about them', () => {
    const kept = addSpot([], { ...PLACE, visits: [VISIT] });
    const again = addSpot(kept, { ...PLACE, name: 'Calton Hill, Edinburgh', savedAt: 2 });
    assert.deepEqual(again[0].visits, [VISIT]);
  });
});

describe('addVisit', () => {
  const VISIT: SpotVisit = { at: 100, sunAltitude: 10, sunAzimuth: 200 };

  it('puts the newest visit first', () => {
    const kept = addSpot([], PLACE);
    const once = addVisit(kept, PLACE, VISIT);
    const twice = addVisit(once, PLACE, { ...VISIT, at: 200, sunAltitude: 20 });
    assert.deepEqual(
      twice[0].visits?.map((v) => v.at),
      [200, 100],
    );
  });

  it('does nothing when the spot is not kept', () => {
    assert.deepEqual(addVisit([], PLACE, VISIT), []);
  });

  it('does not move the spot in the list', () => {
    const list = [
      { ...PLACE, savedAt: 3 },
      { name: 'Arthur’s Seat', lat: 55.944, lon: -3.1618, savedAt: 2 },
    ];
    const next = addVisit(list, PLACE, VISIT);
    assert.equal(next[0].name, 'Calton Hill');
  });
});

describe('closestVisit', () => {
  const low: SpotVisit = { at: 1, sunAltitude: 5, sunAzimuth: 100, outcome: 'Flat light.' };
  const high: SpotVisit = { at: 2, sunAltitude: 40, sunAzimuth: 180 };
  const mid: SpotVisit = { at: 3, sunAltitude: 20, sunAzimuth: 260 };

  it('is null with nothing logged', () => {
    assert.equal(closestVisit(undefined, 10, 0), null);
    assert.equal(closestVisit([], 10, 0), null);
  });

  it('picks the visit closest in sun altitude, ignoring azimuth entirely', () => {
    // `mid` is 100° round in bearing from the target and still wins, because
    // ranking is on altitude alone — see the function's own reasoning for why
    // fusing the two axes would be an invented weighting, not a measured one.
    const match = closestVisit([low, high, mid], 18, 0);
    assert.equal(match?.visit, mid);
    assert.equal(match?.altitudeDiffDeg, 2);
  });

  it('reports the azimuth gap as context without it affecting the pick', () => {
    const match = closestVisit([low], 6, 280);
    assert.equal(match?.visit, low);
    assert.equal(match?.azimuthDiffDeg, 180);
  });

  it("mentions the outcome when there is one, and says plainly when there isn't", () => {
    assert.match(closestVisit([low], 5, 100)!.note, /Flat light\./);
    assert.match(closestVisit([high], 40, 180)!.note, /No outcome was logged\./);
  });
});

describe('formatVisitDate', () => {
  it('reads as a date, not a timestamp', () => {
    assert.match(formatVisitDate(Date.UTC(2025, 5, 3)), /2025/);
    assert.doesNotMatch(formatVisitDate(Date.UTC(2025, 5, 3)), /^\d+$/);
  });
});

describe('describeFrame', () => {
  it('reads as a camera is set', () => {
    assert.equal(describeFrame(FRAME), '24 mm · 270° · +4° tilt');
  });

  it('says nothing about a level camera, and calls out portrait', () => {
    assert.equal(describeFrame({ ...FRAME, tiltDeg: 0 }), '24 mm · 270°');
    assert.equal(
      describeFrame({ ...FRAME, orientation: 'portrait', tiltDeg: 0 }),
      '24 mm · portrait · 270°',
    );
  });
});
