/**
 * The galactic core.
 *
 * There is no published table to check this against the way `sun.ts` can be
 * checked against NOAA, so it is verified against geometry instead — which is
 * stronger where it applies, because it cannot be fitted to. Two identities do
 * most of the work: an object of declination δ can never rise higher than
 * 90° − |φ − δ| from latitude φ, and it transits exactly when the local
 * sidereal time equals its right ascension. Both are exact, neither shares any
 * arithmetic with the code under test, and between them they pin down the
 * declination, the coordinate transform and the clock.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORE_J2000,
  coreNight,
  corePosition,
  coreTimes,
  coreTrack,
  intersect,
  intervalsWhere,
  precess,
} from './galactic';
import { greenwichSiderealTime } from './moon';

const DAY_MS = 86_400_000;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** A whole day, so a transit is in there wherever the place is. */
const dayFrom = (iso: string) => ({ from: new Date(iso), to: new Date(+new Date(iso) + DAY_MS) });

const EDINBURGH = { lat: 55.9533, lon: -3.1883 };
const ATACAMA = { lat: -24.6272, lon: -70.4042 };
const SYDNEY = { lat: -33.8688, lon: 151.2093 };

describe('the galactic core: where it is', () => {
  it('never rises higher than the declination allows', () => {
    // 90 − |φ − δ|, the exact ceiling for any object at any latitude.
    for (const place of [EDINBURGH, ATACAMA, SYDNEY]) {
      const { from, to } = dayFrom('2026-08-07T00:00:00Z');
      const times = coreTimes(place.lat, place.lon, from, to, 1);
      const { declination } = corePosition(place.lat, place.lon, times.peakAt);
      const ceiling = 90 - Math.abs(place.lat - declination);
      assert.ok(
        Math.abs(times.peakAltitude - ceiling) < 0.2,
        `peaked at ${times.peakAltitude.toFixed(2)}°, ceiling is ${ceiling.toFixed(2)}°`,
      );
    }
  });

  it('transits when the local sidereal time reaches its right ascension', () => {
    const { from, to } = dayFrom('2026-08-07T00:00:00Z');
    const times = coreTimes(ATACAMA.lat, ATACAMA.lon, from, to, 1);
    assert.ok(times.transit, 'the core transits at this latitude');

    const position = corePosition(ATACAMA.lat, ATACAMA.lon, times.transit!);
    const localSidereal = norm360(greenwichSiderealTime(times.transit!) + ATACAMA.lon);
    const apart = Math.abs(norm360(localSidereal - position.rightAscension + 180) - 180);
    // The transit is located by sampling at one minute, and the sky turns a
    // quarter of a degree a minute, so half a step is an eighth of a degree.
    assert.ok(apart < 0.5, `sidereal time and right ascension are ${apart.toFixed(3)}° apart`);
    // And the hour angle, which is the same statement made by the other route.
    assert.ok(Math.abs(position.hourAngle) < 0.5);
  });

  it('transits at local midnight in the middle of June', () => {
    // The calendar check, which the two identities above cannot make: the core
    // is opposite the sun — and so highest at midnight — when the sun's own
    // right ascension is 17h45m − 12h = 5h45m, which it reaches around 12 June.
    // This is the fact an astrophotographer actually holds ("core season peaks
    // at midnight in June"), and it ties the sidereal clock to the calendar.
    const from = new Date('2026-06-12T12:00:00Z');
    const to = new Date('2026-06-13T12:00:00Z');
    const times = coreTimes(ATACAMA.lat, 0, from, to, 1);
    assert.ok(times.transit, 'it transits');
    const minutesFromMidnight = Math.abs(
      (+times.transit! - +new Date('2026-06-13T00:00:00Z')) / 60_000,
    );
    assert.ok(
      minutesFromMidnight < 45,
      `transited ${minutesFromMidnight.toFixed(0)} minutes from midnight at Greenwich`,
    );
  });

  it('is below the horizon all day north of about 61°', () => {
    // Declination −29° means the core is circumpolar-never above 90 − 29 = 61°N.
    const { from, to } = dayFrom('2026-08-07T00:00:00Z');
    const arctic = coreTimes(65, 20, from, to, 5);
    assert.equal(arctic.alwaysDown, true);
    assert.equal(arctic.rise, null);
    assert.equal(arctic.transit, null);
    assert.ok(arctic.peakAltitude < 0);
  });

  it('rises and sets on the same day at a latitude where it clears the horizon', () => {
    const { from, to } = dayFrom('2026-08-07T00:00:00Z');
    const times = coreTimes(ATACAMA.lat, ATACAMA.lon, from, to, 5);
    assert.ok(times.rise, 'it rises');
    assert.ok(times.set, 'and sets');
    assert.equal(times.alwaysUp, false);
    assert.equal(times.alwaysDown, false);
    assert.ok(times.peakAltitude > 60, 'and passes nearly overhead from the Atacama');
  });

  it('reports refraction lifting it, and only near the horizon', () => {
    const { from, to } = dayFrom('2026-08-07T00:00:00Z');
    const low = coreTrack(EDINBURGH.lat, EDINBURGH.lon, from, to, 5)
      .filter((s) => s.altitude > 0 && s.altitude < 1)
      .at(0);
    assert.ok(low, 'the core does clear the horizon from Edinburgh, barely');
    assert.ok(low!.altitudeApparent > low!.altitude + 0.2, 'lifted appreciably near the horizon');

    const high = coreTrack(ATACAMA.lat, ATACAMA.lon, from, to, 5).sort(
      (a, b) => b.altitude - a.altitude,
    )[0];
    assert.ok(high.altitudeApparent - high.altitude < 0.02, 'and barely at all near the zenith');
  });
});

describe('the galactic core: precession', () => {
  it('moves the coordinates by about a third of a degree since J2000', () => {
    const now = new Date('2026-08-07T00:00:00Z');
    const moved = precess(CORE_J2000.rightAscension, CORE_J2000.declination, now);
    const shift = moved.rightAscension - CORE_J2000.rightAscension;
    // ~0.014°/year in right ascension, over 26.6 years.
    assert.ok(shift > 0.2 && shift < 0.6, `right ascension moved ${shift.toFixed(3)}°`);
    // Declination barely moves for this object: the rate carries cos(RA), and
    // the core sits where that is nearly zero.
    assert.ok(Math.abs(moved.declination - CORE_J2000.declination) < 0.05);
  });

  it('is an identity at the epoch itself', () => {
    const j2000 = new Date('2000-01-01T12:00:00Z');
    const same = precess(CORE_J2000.rightAscension, CORE_J2000.declination, j2000);
    assert.ok(Math.abs(same.rightAscension - CORE_J2000.rightAscension) < 1e-6);
    assert.ok(Math.abs(same.declination - CORE_J2000.declination) < 1e-6);
  });

  it('is used: the position carries the precessed coordinates, not J2000', () => {
    const at = new Date('2026-08-07T00:00:00Z');
    const { rightAscension } = corePosition(ATACAMA.lat, ATACAMA.lon, at);
    assert.notEqual(rightAscension, CORE_J2000.rightAscension);
    assert.ok(Math.abs(rightAscension - CORE_J2000.rightAscension) < 1);
  });
});

describe('intervals', () => {
  const base = new Date('2026-08-07T00:00:00Z');
  const at = (minutes: number) => new Date(+base + minutes * 60_000);

  it('finds a stretch inside the window and refines both ends', () => {
    // Positive strictly between minute 100 and minute 200.
    const found = intervalsWhere(base, at(300), 10, (t) => {
      const m = (t - +base) / 60_000;
      return (m - 100) * (200 - m);
    });
    assert.equal(found.length, 1);
    assert.ok(Math.abs((+found[0].from - +base) / 60_000 - 100) < 0.02);
    assert.ok(Math.abs((+found[0].to - +base) / 60_000 - 200) < 0.02);
  });

  it('clips a stretch that is open at the start or the end of the window', () => {
    const open = intervalsWhere(base, at(60), 10, () => 1);
    assert.deepEqual(open, [{ from: base, to: at(60) }]);
  });

  it('returns nothing when the condition never holds', () => {
    assert.deepEqual(
      intervalsWhere(base, at(60), 10, () => -1),
      [],
    );
  });

  it('measures the exact end of the window, whatever the step leaves over', () => {
    // A window that is not a whole number of steps: positive only in the last
    // seven minutes, which a loop stepping past the end would step over.
    const found = intervalsWhere(base, at(25), 10, (t) => (t - +base) / 60_000 - 18);
    assert.equal(found.length, 1);
    assert.equal(+found[0].to, +at(25));
  });

  it('intersects two sets of stretches', () => {
    const a = [
      { from: at(0), to: at(100) },
      { from: at(200), to: at(300) },
    ];
    const b = [
      { from: at(50), to: at(250) },
      { from: at(280), to: at(400) },
    ];
    assert.deepEqual(intersect(a, b), [
      { from: at(50), to: at(100) },
      { from: at(200), to: at(250) },
      { from: at(280), to: at(300) },
    ]);
  });

  it('touching stretches do not count as an overlap', () => {
    assert.deepEqual(
      intersect([{ from: at(0), to: at(100) }], [{ from: at(100), to: at(200) }]),
      [],
    );
  });
});

describe('the galactic core: a night', () => {
  it('refuses Edinburgh, and says which condition failed', () => {
    const from = new Date('2026-08-07T18:00:00Z');
    const to = new Date('2026-08-08T06:00:00Z');
    const result = coreNight(EDINBURGH.lat, EDINBURGH.lon, from, to);
    assert.deepEqual(result.visible, []);
    assert.equal(result.best, null);
    // It does clear the horizon there — about five degrees — so the refusal has
    // to be about the usable altitude, not about it never rising.
    assert.match(result.refusal, /does not clear 10°/);
    assert.ok(result.core.peakAltitude > 0 && result.core.peakAltitude < 6);
  });

  it('refuses a latitude the core never reaches at all', () => {
    const from = new Date('2026-08-07T18:00:00Z');
    const to = new Date('2026-08-08T06:00:00Z');
    const result = coreNight(70, 20, from, to);
    assert.equal(result.refusal, 'The core never rises here.');
  });

  it('finds moon-free dark hours with the core high, from the Atacama', () => {
    // Somewhere within a lunar month there must be a night that works from one
    // of the darkest, highest places on earth in core season. Which night it is
    // depends on the moon, so the test asks the question a photographer would:
    // is there one at all this month?
    let found = 0;
    let bestAltitude = 0;
    for (let day = 1; day <= 28; day++) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      const result = coreNight(
        ATACAMA.lat,
        ATACAMA.lon,
        new Date(`${date}T22:00:00Z`),
        new Date(`${date}T11:00:00Z`.replace(date, shiftDay(date))),
      );
      if (result.visible.length) {
        found++;
        bestAltitude = Math.max(bestAltitude, result.best?.altitude ?? 0);
        assert.equal(result.refusal, '', 'a night that works must not also carry a refusal');
      }
    }
    assert.ok(found > 5, `only ${found} of 28 nights worked`);
    assert.ok(bestAltitude > 40, `the best the core managed was ${bestAltitude.toFixed(1)}°`);
  });

  it('never reports a window that is not inside all three conditions', () => {
    const from = new Date('2026-08-14T22:00:00Z');
    const to = new Date('2026-08-15T11:00:00Z');
    const result = coreNight(ATACAMA.lat, ATACAMA.lon, from, to);
    for (const window of result.visible) {
      const inside = (list: { from: Date; to: Date }[]) =>
        list.some((w) => w.from <= window.from && w.to >= window.to);
      assert.ok(inside(result.darkness), 'inside astronomical darkness');
      assert.ok(inside(result.moonFree), 'and inside a moon-free stretch');
    }
  });
});

/** Next calendar day, for building a window that crosses midnight. */
function shiftDay(isoDate: string): string {
  const next = new Date(`${isoDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
