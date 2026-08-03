import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { domePath, domePosition, domeRadiusFor, hourMarks, splitAtHorizon } from './dome.ts';
import { distance, initialBearing, type LatLon } from './geo.ts';

const CENTRE: LatLon = { lat: 35.6595, lon: 139.7005 };
const R = 500;

/** Straight-line distance from the centre through 3D space. */
const slant = (p: { lon: number; lat: number; altitudeM: number }) =>
  Math.hypot(distance(CENTRE, { lat: p.lat, lon: p.lon }), p.altitudeM);

describe('domePosition', () => {
  it('places every sun position on a sphere of the given radius', () => {
    for (const altitude of [0, 5, 15, 30, 45, 60, 89]) {
      for (const azimuth of [0, 47, 90, 180, 271, 359]) {
        const p = domePosition(CENTRE, azimuth, altitude, R);
        assert.ok(Math.abs(slant(p) - R) < 0.5, `${azimuth}/${altitude}: ${slant(p)}`);
      }
    }
  });

  it('keeps the compass bearing of the sun', () => {
    for (const azimuth of [0, 45, 120, 200, 300]) {
      const p = domePosition(CENTRE, azimuth, 30, R);
      const bearing = initialBearing(CENTRE, { lat: p.lat, lon: p.lon });
      assert.ok(Math.abs(((bearing - azimuth + 540) % 360) - 180) < 0.5, `${azimuth} → ${bearing}`);
    }
  });

  it('puts the horizon on the rim and the zenith at the centre', () => {
    const horizon = domePosition(CENTRE, 90, 0, R);
    assert.ok(Math.abs(distance(CENTRE, { lat: horizon.lat, lon: horizon.lon }) - R) < 0.5);
    assert.ok(Math.abs(horizon.altitudeM) < 0.5);

    const zenith = domePosition(CENTRE, 90, 90, R);
    assert.ok(distance(CENTRE, { lat: zenith.lat, lon: zenith.lon }) < 0.5);
    assert.ok(Math.abs(zenith.altitudeM - R) < 0.5);
  });

  it('goes below ground when the sun is down', () => {
    const night = domePosition(CENTRE, 180, -20, R);
    assert.ok(night.altitudeM < 0, `${night.altitudeM}`);
    assert.equal(night.sunAltitude, -20);
  });

  it('rises monotonically with the sun', () => {
    let previous = -Infinity;
    for (const altitude of [-10, 0, 10, 30, 60, 90]) {
      const p = domePosition(CENTRE, 180, altitude, R);
      assert.ok(p.altitudeM > previous, `${altitude}`);
      previous = p.altitudeM;
    }
  });
});

describe('domePath', () => {
  it('maps every sample, in order', () => {
    const samples = [
      { azimuth: 90, altitude: 0 },
      { azimuth: 180, altitude: 40 },
      { azimuth: 270, altitude: 0 },
    ];
    const path = domePath(CENTRE, samples, R);
    assert.equal(path.length, 3);
    assert.ok(path[1].altitudeM > path[0].altitudeM);
    assert.ok(path[1].altitudeM > path[2].altitudeM);
  });

  it('traces a closed-ish ring across a whole day', () => {
    // A synthetic day: azimuth sweeping right round, altitude a sine arc.
    const samples = Array.from({ length: 96 }, (_, i) => ({
      azimuth: (i / 96) * 360,
      altitude: 40 * Math.sin((i / 96) * 2 * Math.PI),
    }));
    const path = domePath(CENTRE, samples, R);
    for (const p of path) assert.ok(Math.abs(slant(p) - R) < 0.5);
  });
});

describe('domeRadiusFor', () => {
  it('scales with the scouted area but stays within useful bounds', () => {
    assert.equal(domeRadiusFor(1000), 180); // floor
    assert.equal(domeRadiusFor(50_000), 1200); // ceiling
    assert.ok(domeRadiusFor(10_000) > 180 && domeRadiusFor(10_000) < 1200);
  });

  it('never shrinks as the area grows', () => {
    let previous = 0;
    for (const r of [1000, 5000, 10_000, 25_000, 50_000]) {
      const value = domeRadiusFor(r);
      assert.ok(value >= previous, `${r}`);
      previous = value;
    }
  });
});

describe('splitAtHorizon', () => {
  const at = (sunAltitude: number) => ({ lon: 0, lat: 0, altitudeM: sunAltitude, sunAltitude });

  it('separates the daylight arc from the night one', () => {
    const { above, below } = splitAtHorizon([at(-5), at(-1), at(3), at(20), at(4), at(-2), at(-8)]);
    assert.equal(above.length, 1);
    assert.equal(below.length, 2);
  });

  it('joins the runs at the crossing so there is no gap', () => {
    const { above, below } = splitAtHorizon([at(-1), at(5), at(9)]);
    // The boundary sample is the last of one run and the first of the next.
    assert.equal(below[0][below[0].length - 1].sunAltitude, 5);
    assert.equal(above[0][0].sunAltitude, 5);
  });

  it('handles a day entirely above or entirely below', () => {
    const allDay = splitAtHorizon([at(5), at(10), at(15)]);
    assert.equal(allDay.above.length, 1);
    assert.equal(allDay.below.length, 0);

    const polarNight = splitAtHorizon([at(-5), at(-10)]);
    assert.equal(polarNight.above.length, 0);
    assert.equal(polarNight.below.length, 1);
  });

  it('drops runs too short to draw', () => {
    const { above } = splitAtHorizon([at(5)]);
    assert.equal(above.length, 0);
  });
});

describe('hourMarks', () => {
  const day = Array.from({ length: 24 * 6 }, (_, i) => ({
    azimuth: (i / (24 * 6)) * 360,
    altitude: 40 * Math.sin((i / (24 * 6)) * 2 * Math.PI),
    date: new Date(Date.UTC(2026, 6, 31, Math.floor(i / 6), (i % 6) * 10)),
  }));

  it('marks each whole hour the sun is up, once', () => {
    const marks = hourMarks(CENTRE, day, R, 'UTC');
    const hours = marks.map((m) => m.hour);
    assert.equal(new Set(hours).size, hours.length, 'duplicate hours');
    assert.ok(marks.every((m) => m.sunAltitude >= 0));
    assert.ok(marks.length > 5 && marks.length < 24, `${marks.length}`);
  });

  it('reads hours in the scouted timezone, not the reader’s', () => {
    const utc = hourMarks(CENTRE, day, R, 'UTC').map((m) => m.hour);
    const tokyo = hourMarks(CENTRE, day, R, 'Asia/Tokyo').map((m) => m.hour);
    assert.notDeepEqual(utc, tokyo);
  });

  it('falls back rather than throwing on a bad zone', () => {
    assert.doesNotThrow(() => hourMarks(CENTRE, day, R, 'Nowhere/Nothing'));
  });

  it('marks nothing when the sun never rises', () => {
    const night = day.map((d) => ({ ...d, altitude: -10 }));
    assert.deepEqual(hourMarks(CENTRE, night, R, 'UTC'), []);
  });
});
