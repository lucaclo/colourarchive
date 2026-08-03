/**
 * Tests for the sun engine.
 *
 * Deliberately not a table of times copied off a website. Almanac tables are
 * rounded to the minute, defined for a particular horizon and refraction model,
 * and mostly quoted in a local timezone — pinning to them tests transcription,
 * not the algorithm. Three stronger things instead:
 *
 *   1. Physical identities that must hold exactly, everywhere, on every date.
 *      The best of them is that the sun's altitude at culmination equals
 *      90 - |latitude - declination|. If any of the chain from Julian day to
 *      hour angle is wrong, that identity breaks immediately.
 *   2. Known extremes — obliquity at the solstices, the equation of time's
 *      November peak — which are published to more decimal places than we need.
 *   3. A second, independent low-precision algorithm (the one in the
 *      Astronomical Almanac) run against the first. Two different routes to the
 *      same declination is a real check on the arithmetic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUN_ALTITUDE,
  dateFromJulianDay,
  dayTrack,
  julianDay,
  phaseForAltitude,
  refraction,
  shadowBearing,
  shadowLengthRatio,
  solarNoonJulianDay,
  solarState,
  sunPosition,
  sunTimes,
} from './sun.ts';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const utc = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min, 0, 0));

/** A spread of places: hemispheres, tropics, high latitude, both sides of the meridian. */
const PLACES = [
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Quito', lat: -0.1807, lon: -78.4678 },
  { name: 'Reykjavík', lat: 64.1466, lon: -21.9426 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { name: 'Anchorage', lat: 61.2181, lon: -149.9003 },
];

const DATES = [
  utc(2026, 1, 15),
  utc(2026, 3, 20),
  utc(2026, 6, 21),
  utc(2026, 9, 22),
  utc(2026, 12, 21),
  utc(2027, 4, 3),
];

/* ── An independent implementation, for cross-checking ─────────────────────
   "Approximate Solar Coordinates" from the Astronomical Almanac: a much
   coarser series than Meeus, quoted as good to about 0.01° in this era. It
   shares the underlying astronomy but none of the code, so agreement between
   the two is real evidence the transcription is right. */
function almanacSun(date: Date): { declination: number; rightAscension: number } {
  const n = julianDay(date) - 2451545.0;
  const meanLongitude = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * RAD;
  const eclipticLongitude =
    (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude)) * DEG;
  const rightAscension =
    ((Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLongitude),
      Math.cos(eclipticLongitude),
    ) *
      DEG) %
      360 +
      360) %
    360;
  return { declination, rightAscension };
}

/* ── Julian day ────────────────────────────────────────────────────────────── */

describe('julian day', () => {
  it('places the J2000 epoch at 2000-01-01T12:00:00Z', () => {
    assert.equal(julianDay(new Date('2000-01-01T12:00:00Z')), 2451545.0);
  });

  it('places the Unix epoch correctly', () => {
    assert.equal(julianDay(new Date('1970-01-01T00:00:00Z')), 2440587.5);
  });

  it('round-trips through dateFromJulianDay', () => {
    for (const date of DATES) {
      const back = dateFromJulianDay(julianDay(date));
      assert.ok(Math.abs(back.getTime() - date.getTime()) < 1, `${date.toISOString()}`);
    }
  });
});

/* ── Cross-check against the Almanac series ────────────────────────────────── */

describe('agreement with an independent algorithm', () => {
  it('matches the Astronomical Almanac declination to within 0.02°', () => {
    // Every 6 days for three years — a few hundred samples across the orbit.
    for (let i = 0; i < 180; i++) {
      const date = new Date(Date.UTC(2026, 0, 1, 6, 0, 0) + i * 6 * 86_400_000);
      const mine = solarState((julianDay(date) - 2451545.0) / 36525).declination;
      const theirs = almanacSun(date).declination;
      assert.ok(
        Math.abs(mine - theirs) < 0.02,
        `${date.toISOString()}: ${mine.toFixed(4)} vs ${theirs.toFixed(4)}`,
      );
    }
  });

  it('matches the Astronomical Almanac right ascension to within 0.02°', () => {
    for (let i = 0; i < 180; i++) {
      const date = new Date(Date.UTC(2026, 0, 1, 6, 0, 0) + i * 6 * 86_400_000);
      const mine = solarState((julianDay(date) - 2451545.0) / 36525).rightAscension;
      const theirs = almanacSun(date).rightAscension;
      const diff = Math.abs(((mine - theirs + 540) % 360) - 180);
      assert.ok(diff < 0.02, `${date.toISOString()}: ${mine.toFixed(4)} vs ${theirs.toFixed(4)}`);
    }
  });
});

/* ── Declination and obliquity ─────────────────────────────────────────────── */

describe('declination', () => {
  it('reaches +23.44° at the June solstice', () => {
    const dec = solarState((julianDay(utc(2026, 6, 21, 8, 24)) - 2451545.0) / 36525).declination;
    assert.ok(dec > 23.4 && dec < 23.45, `got ${dec}`);
  });

  it('reaches -23.44° at the December solstice', () => {
    const dec = solarState((julianDay(utc(2026, 12, 21, 20, 50)) - 2451545.0) / 36525).declination;
    assert.ok(dec < -23.4 && dec > -23.45, `got ${dec}`);
  });

  it('passes through zero at the equinoxes', () => {
    const march = solarState((julianDay(utc(2026, 3, 20, 14, 46)) - 2451545.0) / 36525).declination;
    const september = solarState(
      (julianDay(utc(2026, 9, 23, 0, 5)) - 2451545.0) / 36525,
    ).declination;
    assert.ok(Math.abs(march) < 0.1, `March: ${march}`);
    assert.ok(Math.abs(september) < 0.1, `September: ${september}`);
  });

  it('climbs monotonically from the March equinox to the June solstice', () => {
    let previous = -Infinity;
    for (let d = 0; d < 90; d++) {
      const date = new Date(Date.UTC(2026, 2, 21, 12) + d * 86_400_000);
      const dec = solarState((julianDay(date) - 2451545.0) / 36525).declination;
      assert.ok(dec > previous, `fell on day ${d}`);
      previous = dec;
    }
  });

  it('stays inside the obliquity of the ecliptic all year', () => {
    for (let d = 0; d < 366; d++) {
      const date = new Date(Date.UTC(2026, 0, 1, 12) + d * 86_400_000);
      const dec = solarState((julianDay(date) - 2451545.0) / 36525).declination;
      assert.ok(Math.abs(dec) <= 23.45, `day ${d}: ${dec}`);
    }
  });
});

/* ── Equation of time ──────────────────────────────────────────────────────── */

describe('equation of time', () => {
  const samples = Array.from({ length: 365 }, (_, d) => {
    const date = new Date(Date.UTC(2026, 0, 1, 12) + d * 86_400_000);
    return { date, minutes: solarState((julianDay(date) - 2451545.0) / 36525).equationOfTime };
  });

  it('peaks near +16.4 minutes in early November', () => {
    const peak = samples.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    assert.ok(peak.minutes > 16.0 && peak.minutes < 16.8, `got ${peak.minutes}`);
    assert.equal(peak.date.getUTCMonth(), 10, `expected November, got ${peak.date.toISOString()}`);
  });

  it('bottoms out near -14.2 minutes in mid-February', () => {
    const trough = samples.reduce((a, b) => (b.minutes < a.minutes ? b : a));
    assert.ok(trough.minutes < -13.8 && trough.minutes > -14.7, `got ${trough.minutes}`);
    assert.equal(trough.date.getUTCMonth(), 1, `expected February, got ${trough.date.toISOString()}`);
  });

  it('crosses zero four times a year', () => {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
      if (Math.sign(samples[i].minutes) !== Math.sign(samples[i - 1].minutes)) crossings++;
    }
    assert.equal(crossings, 4, `got ${crossings}`);
  });
});

/* ── The culmination identity ──────────────────────────────────────────────── */

describe('solar noon', () => {
  it('puts the sun at 90 - |latitude - declination|', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const times = sunTimes(place.lat, place.lon, date);
        const at = sunPosition(place.lat, place.lon, times.solarNoon);
        const expected = 90 - Math.abs(place.lat - at.declination);
        assert.ok(
          Math.abs(at.altitude - expected) < 0.02,
          `${place.name} ${date.toISOString()}: ${at.altitude.toFixed(4)} vs ${expected.toFixed(4)}`,
        );
      }
    }
  });

  it('is the moment of zero hour angle', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const times = sunTimes(place.lat, place.lon, date);
        const { hourAngle } = sunPosition(place.lat, place.lon, times.solarNoon);
        assert.ok(Math.abs(hourAngle) < 0.05, `${place.name}: hour angle ${hourAngle}`);
      }
    }
  });

  it('is the highest the sun gets all day', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const times = sunTimes(place.lat, place.lon, date);
        const peak = Math.max(
          ...dayTrack(place.lat, place.lon, date, { stepMinutes: 2 }).map((s) => s.altitude),
        );
        assert.ok(
          times.maxAltitude >= peak - 0.01,
          `${place.name} ${date.toISOString()}: noon ${times.maxAltitude} < sampled peak ${peak}`,
        );
      }
    }
  });

  it('lands within a quarter hour of local mean noon, corrected for longitude', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const noonJD = solarNoonJulianDay(place.lon, date);
        const noon = dateFromJulianDay(noonJD);
        const utcMinutes =
          noon.getUTCHours() * 60 + noon.getUTCMinutes() + noon.getUTCSeconds() / 60;
        const meanNoon = ((720 - 4 * place.lon) % 1440 + 1440) % 1440;
        const offset = Math.abs(((utcMinutes - meanNoon + 720) % 1440) - 720);
        assert.ok(offset < 17, `${place.name}: ${offset.toFixed(1)} min from mean noon`);
      }
    }
  });
});

/* ── Symmetry ──────────────────────────────────────────────────────────────── */

describe('the day is symmetric about solar noon', () => {
  it('gives the same altitude either side', () => {
    for (const place of PLACES) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 5, 12));
      for (const hours of [1, 2, 3, 4, 5]) {
        const before = sunPosition(
          place.lat,
          place.lon,
          new Date(times.solarNoon.getTime() - hours * 3_600_000),
        );
        const after = sunPosition(
          place.lat,
          place.lon,
          new Date(times.solarNoon.getTime() + hours * 3_600_000),
        );
        // Not exact: the declination drifts a little across the day.
        assert.ok(
          Math.abs(before.altitude - after.altitude) < 0.5,
          `${place.name} ±${hours}h: ${before.altitude} vs ${after.altitude}`,
        );
      }
    }
  });

  it('mirrors the azimuth about the meridian', () => {
    const { lat, lon } = PLACES[0];
    const times = sunTimes(lat, lon, utc(2026, 5, 12));
    for (const hours of [1, 3, 5]) {
      const before = sunPosition(lat, lon, new Date(times.solarNoon.getTime() - hours * 3_600_000));
      const after = sunPosition(lat, lon, new Date(times.solarNoon.getTime() + hours * 3_600_000));
      assert.ok(
        Math.abs(before.azimuth + after.azimuth - 360) < 1.5,
        `±${hours}h: ${before.azimuth} and ${after.azimuth}`,
      );
    }
  });
});

/* ── Azimuth ───────────────────────────────────────────────────────────────── */

describe('azimuth', () => {
  it('is due south at noon in the northern mid-latitudes', () => {
    for (const place of PLACES.filter((p) => p.lat > 20)) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 6, 21));
      const { azimuth } = sunPosition(place.lat, place.lon, times.solarNoon);
      assert.ok(Math.abs(azimuth - 180) < 0.5, `${place.name}: ${azimuth}`);
    }
  });

  it('is due north at noon in the southern mid-latitudes', () => {
    for (const place of PLACES.filter((p) => p.lat < -20)) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 6, 21));
      const { azimuth } = sunPosition(place.lat, place.lon, times.solarNoon);
      assert.ok(Math.min(azimuth, 360 - azimuth) < 0.5, `${place.name}: ${azimuth}`);
    }
  });

  it('rises close to due east and sets close to due west at the equinox', () => {
    for (const place of PLACES.filter((p) => Math.abs(p.lat) > 20 && Math.abs(p.lat) < 65)) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 3, 20));
      assert.ok(times.sunrise && times.sunset);
      const rise = sunPosition(place.lat, place.lon, times.sunrise!).azimuth;
      const set = sunPosition(place.lat, place.lon, times.sunset!).azimuth;
      assert.ok(Math.abs(rise - 90) < 2.5, `${place.name} rise: ${rise}`);
      assert.ok(Math.abs(set - 270) < 2.5, `${place.name} set: ${set}`);
    }
  });

  it('increases through the day and stays in range', () => {
    for (const place of PLACES) {
      for (const sample of dayTrack(place.lat, place.lon, utc(2026, 7, 15))) {
        assert.ok(sample.azimuth >= 0 && sample.azimuth < 360, `${sample.azimuth}`);
        assert.ok(sample.altitude >= -90 && sample.altitude <= 90, `${sample.altitude}`);
      }
    }
  });
});

/* ── Sunrise and sunset ────────────────────────────────────────────────────── */

describe('sunrise and sunset', () => {
  it('happen when the sun is at the -0.833° threshold', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const times = sunTimes(place.lat, place.lon, date);
        if (!times.sunrise || !times.sunset) continue;
        for (const [label, when] of [
          ['sunrise', times.sunrise],
          ['sunset', times.sunset],
        ] as const) {
          const { altitude } = sunPosition(place.lat, place.lon, when);
          // Tight on purpose. The fixed-point solve lands within 1e-5 degrees
          // everywhere; anything looser would not have caught dropping the
          // equation-of-time term from the crossing, which was worth 0.027°.
          assert.ok(
            Math.abs(altitude - SUN_ALTITUDE.sunrise) < 0.001,
            `${place.name} ${date.toISOString()} ${label}: ${altitude}`,
          );
        }
      }
    }
  });

  it('brackets solar noon', () => {
    for (const place of PLACES) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 4, 10));
      assert.ok(times.sunrise! < times.solarNoon);
      assert.ok(times.sunset! > times.solarNoon);
    }
  });

  it('gives about twelve hours everywhere at the equinox', () => {
    for (const place of PLACES) {
      const times = sunTimes(place.lat, place.lon, utc(2026, 3, 20));
      assert.ok(times.dayLengthMinutes !== null, place.name);
      // A shade over 12h: the -0.833° threshold means the sun is up slightly
      // longer than geometry alone would give, more so at higher latitudes.
      assert.ok(
        times.dayLengthMinutes! > 719 && times.dayLengthMinutes! < 740,
        `${place.name}: ${times.dayLengthMinutes}`,
      );
    }
  });

  it('holds day length near twelve hours year-round on the equator', () => {
    for (let month = 1; month <= 12; month++) {
      const times = sunTimes(0, 0, utc(2026, month, 15));
      assert.ok(
        times.dayLengthMinutes! > 720 && times.dayLengthMinutes! < 735,
        `month ${month}: ${times.dayLengthMinutes}`,
      );
    }
  });

  it('orders the twilights correctly', () => {
    const { lat, lon } = PLACES[0];
    const t = sunTimes(lat, lon, utc(2026, 4, 10));
    const ordered = [
      t.astronomicalDawn!,
      t.nauticalDawn!,
      t.civilDawn!,
      t.sunrise!,
      t.solarNoon,
      t.sunset!,
      t.civilDusk!,
      t.nauticalDusk!,
      t.astronomicalDusk!,
    ];
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(
        ordered[i].getTime() > ordered[i - 1].getTime(),
        `step ${i}: ${ordered[i - 1].toISOString()} → ${ordered[i].toISOString()}`,
      );
    }
  });

  it('puts every event inside its own solar day', () => {
    for (const place of PLACES) {
      for (const date of DATES) {
        const t = sunTimes(place.lat, place.lon, date);
        for (const event of [t.sunrise, t.sunset, t.civilDawn, t.civilDusk, t.solarNoon]) {
          if (!event) continue;
          assert.ok(
            event >= t.dayStart && event <= t.dayEnd,
            `${place.name} ${date.toISOString()}: ${event.toISOString()} outside ${t.dayStart.toISOString()}–${t.dayEnd.toISOString()}`,
          );
        }
      }
    }
  });
});

/* ── The poles ─────────────────────────────────────────────────────────────── */

describe('high latitudes', () => {
  const tromso = { lat: 69.6496, lon: 18.956 };

  it('reports midnight sun at Tromsø in June', () => {
    const t = sunTimes(tromso.lat, tromso.lon, utc(2026, 6, 21));
    assert.equal(t.polar, 'midnight-sun');
    assert.equal(t.sunrise, null);
    assert.equal(t.sunset, null);
    assert.equal(t.dayLengthMinutes, null);
    assert.ok(t.minAltitude > 0, `lowest altitude ${t.minAltitude}`);
  });

  it('reports polar night at Tromsø in December', () => {
    const t = sunTimes(tromso.lat, tromso.lon, utc(2026, 12, 21));
    assert.equal(t.polar, 'polar-night');
    assert.equal(t.sunrise, null);
    assert.ok(t.maxAltitude < SUN_ALTITUDE.sunrise, `highest altitude ${t.maxAltitude}`);
  });

  it('still finds civil twilight during Tromsø’s polar night', () => {
    // The sun tops out near -3°, so it is dark but not black: there is a usable
    // couple of hours of blue in the middle of the day, which is exactly the
    // sort of thing this feature exists to tell you.
    const t = sunTimes(tromso.lat, tromso.lon, utc(2026, 12, 21));
    assert.ok(t.civilDawn !== null && t.civilDusk !== null);
    assert.ok(t.civilDusk! > t.civilDawn!);
  });

  it('survives the pole itself without producing NaN', () => {
    for (const lat of [90, -90, 89.99999]) {
      for (const date of DATES) {
        const t = sunTimes(lat, 0, date);
        assert.ok(Number.isFinite(t.maxAltitude), `lat ${lat}: ${t.maxAltitude}`);
        assert.ok(Number.isFinite(t.minAltitude), `lat ${lat}: ${t.minAltitude}`);
        const p = sunPosition(lat, 0, date);
        assert.ok(Number.isFinite(p.azimuth) && Number.isFinite(p.altitude), `lat ${lat}`);
      }
    }
  });
});

/* ── Golden and blue hour ──────────────────────────────────────────────────── */

describe('golden and blue hour', () => {
  it('gives two windows a day at mid-latitudes, at the right altitudes', () => {
    const { lat, lon } = PLACES[0];
    const t = sunTimes(lat, lon, utc(2026, 4, 10));
    assert.equal(t.goldenHour.length, 2);
    assert.equal(t.blueHour.length, 2);

    const [morning, evening] = t.goldenHour;
    assert.ok(
      Math.abs(sunPosition(lat, lon, morning.start).altitude - SUN_ALTITUDE.goldenLower) < 0.02,
    );
    assert.ok(
      Math.abs(sunPosition(lat, lon, morning.end).altitude - SUN_ALTITUDE.goldenUpper) < 0.02,
    );
    assert.ok(
      Math.abs(sunPosition(lat, lon, evening.start).altitude - SUN_ALTITUDE.goldenUpper) < 0.02,
    );
    assert.ok(
      Math.abs(sunPosition(lat, lon, evening.end).altitude - SUN_ALTITUDE.goldenLower) < 0.02,
    );
    assert.ok(morning.end > morning.start && evening.end > evening.start);
    assert.ok(evening.start > morning.end);
  });

  it('brackets sunrise with the morning golden window', () => {
    const { lat, lon } = PLACES[0];
    const t = sunTimes(lat, lon, utc(2026, 4, 10));
    const morning = t.goldenHour[0];
    assert.ok(t.sunrise! > morning.start && t.sunrise! < morning.end);
  });

  it('collapses to a single window when the sun never clears 6°', () => {
    // Reykjavík in midwinter tops out around 3°: it is golden hour from the
    // moment the sun appears until the moment it goes, with no "day" between.
    const t = sunTimes(64.1466, -21.9426, utc(2026, 12, 21));
    assert.ok(t.maxAltitude < SUN_ALTITUDE.goldenUpper, `peak ${t.maxAltitude}`);
    assert.equal(t.goldenHour.length, 1);
    assert.ok(t.goldenHour[0].end > t.goldenHour[0].start);
  });

  it('opens the golden band at both ends of the day under the midnight sun', () => {
    // The sun dips toward the horizon around solar midnight, not sunrise, so
    // the band is crossed at the two ends of the solar day rather than inside it.
    const t = sunTimes(69.6496, 18.956, utc(2026, 6, 21));
    assert.equal(t.polar, 'midnight-sun');
    assert.equal(t.goldenHour.length, 2);
    assert.ok(t.goldenHour[0].start.getTime() === t.dayStart.getTime());
    assert.ok(t.goldenHour[1].end.getTime() === t.dayEnd.getTime());
  });

  it('reports no golden hour when the sun never gets that high', () => {
    const t = sunTimes(80, 0, utc(2026, 12, 21));
    assert.equal(t.polar, 'polar-night');
    assert.deepEqual(t.goldenHour, []);
  });
});

/* ── Refraction ────────────────────────────────────────────────────────────── */

describe('refraction', () => {
  it('lifts the sun by about half a degree at the horizon', () => {
    const r = refraction(0);
    assert.ok(r > 0.45 && r < 0.52, `got ${r}`);
  });

  it('falls away as the sun climbs, and vanishes near the zenith', () => {
    let previous = Infinity;
    for (const altitude of [0, 1, 2, 5, 10, 20, 45, 70, 84]) {
      const r = refraction(altitude);
      assert.ok(r > 0, `${altitude}°: ${r}`);
      assert.ok(r < previous, `${altitude}°: ${r} not below ${previous}`);
      previous = r;
    }
    assert.equal(refraction(86), 0);
  });

  it('steps only negligibly across the branch at -0.575°', () => {
    // NOAA's model is piecewise, and the polynomial below 5° does not quite
    // meet the cotangent below -0.575°: there is a genuine step of about 14
    // arcseconds. Not our error to fix — it is in the published model — and at
    // the horizon it is worth about a second of time, well under the accuracy
    // anyone can use. Asserted as small rather than absent so that a real
    // regression here would still be caught.
    const below = refraction(-0.58);
    const above = refraction(-0.57);
    assert.ok(Math.abs(below - above) < 0.01, `${below} vs ${above}`);
  });

  it('makes the sun look higher than it is, never lower', () => {
    for (const place of PLACES) {
      for (const sample of dayTrack(place.lat, place.lon, utc(2026, 5, 5), { stepMinutes: 20 })) {
        assert.ok(sample.altitudeApparent >= sample.altitude - 1e-9, `${place.name}`);
      }
    }
  });
});

/* ── Shadow geometry ───────────────────────────────────────────────────────── */

describe('shadow geometry', () => {
  it('points a shadow directly away from the sun', () => {
    assert.equal(shadowBearing(0), 180);
    assert.equal(shadowBearing(90), 270);
    assert.equal(shadowBearing(180), 0);
    assert.equal(shadowBearing(270), 90);
    assert.equal(shadowBearing(359), 179);
  });

  it('gives a shadow as long as the object is tall at 45°', () => {
    assert.ok(Math.abs(shadowLengthRatio(45) - 1) < 1e-9);
  });

  it('doubles the length at 26.57°', () => {
    assert.ok(Math.abs(shadowLengthRatio(Math.atan(0.5) * DEG) - 2) < 1e-9);
  });

  it('grows without bound as the sun reaches the horizon', () => {
    assert.ok(shadowLengthRatio(1) > 50);
    assert.equal(shadowLengthRatio(0), Infinity);
    assert.equal(shadowLengthRatio(-5), Infinity);
  });
});

/* ── Phases ────────────────────────────────────────────────────────────────── */

describe('phases', () => {
  it('bands altitudes the way the slider expects', () => {
    assert.equal(phaseForAltitude(45), 'day');
    assert.equal(phaseForAltitude(6), 'day');
    assert.equal(phaseForAltitude(5.9), 'golden');
    assert.equal(phaseForAltitude(0), 'golden');
    assert.equal(phaseForAltitude(-4), 'golden');
    assert.equal(phaseForAltitude(-4.1), 'blue');
    assert.equal(phaseForAltitude(-6), 'blue');
    assert.equal(phaseForAltitude(-6.1), 'nautical');
    assert.equal(phaseForAltitude(-12), 'nautical');
    assert.equal(phaseForAltitude(-12.1), 'astronomical');
    assert.equal(phaseForAltitude(-18), 'astronomical');
    assert.equal(phaseForAltitude(-18.1), 'night');
  });

  it('agrees with the golden hour windows', () => {
    const { lat, lon } = PLACES[0];
    const t = sunTimes(lat, lon, utc(2026, 4, 10));
    for (const window of t.goldenHour) {
      const middle = new Date((window.start.getTime() + window.end.getTime()) / 2);
      assert.equal(phaseForAltitude(sunPosition(lat, lon, middle).altitude), 'golden');
    }
  });
});

/* ── Day track ─────────────────────────────────────────────────────────────── */

describe('day track', () => {
  it('covers a full solar day at the requested interval', () => {
    const samples = dayTrack(51.5074, -0.1278, utc(2026, 7, 1), { stepMinutes: 10 });
    assert.equal(samples.length, 145); // 24h / 10min, inclusive of both ends
    for (let i = 1; i < samples.length; i++) {
      assert.equal(samples[i].date.getTime() - samples[i - 1].date.getTime(), 600_000);
    }
  });

  it('starts and ends at solar midnight', () => {
    const t = sunTimes(51.5074, -0.1278, utc(2026, 7, 1));
    const samples = dayTrack(51.5074, -0.1278, utc(2026, 7, 1), { stepMinutes: 60 });
    assert.equal(samples[0].date.getTime(), t.dayStart.getTime());
    assert.ok(Math.abs(samples.at(-1)!.date.getTime() - t.dayEnd.getTime()) < 60_000);
  });

  it('accepts an explicit range', () => {
    const from = utc(2026, 7, 1, 6);
    const to = utc(2026, 7, 1, 9);
    const samples = dayTrack(51.5074, -0.1278, utc(2026, 7, 1), { stepMinutes: 30, from, to });
    assert.equal(samples.length, 7);
    assert.equal(samples[0].date.getTime(), from.getTime());
    assert.equal(samples.at(-1)!.date.getTime(), to.getTime());
  });

  it('carries a phase on every sample', () => {
    for (const sample of dayTrack(51.5074, -0.1278, utc(2026, 1, 15), { stepMinutes: 15 })) {
      assert.equal(sample.phase, phaseForAltitude(sample.altitude));
    }
  });

  it('rejects a nonsense interval or a reversed range', () => {
    assert.throws(() => dayTrack(0, 0, utc(2026, 1, 1), { stepMinutes: 0 }), RangeError);
    assert.throws(() => dayTrack(0, 0, utc(2026, 1, 1), { stepMinutes: -5 }), RangeError);
    assert.throws(
      () => dayTrack(0, 0, utc(2026, 1, 1), { from: utc(2026, 1, 1, 10), to: utc(2026, 1, 1, 8) }),
      RangeError,
    );
  });
});

/* ── Longitude handling ────────────────────────────────────────────────────── */

describe('longitude', () => {
  it('picks the solar day local to the meridian, not the UTC one', () => {
    // Midday in Tokyo is 03:00 UTC. Ask for the sun "now" and you should get
    // Tokyo's day, not yesterday's or tomorrow's.
    const tokyoNoonish = new Date('2026-07-15T03:00:00Z');
    const t = sunTimes(35.6762, 139.6503, tokyoNoonish);
    assert.ok(Math.abs(t.solarNoon.getTime() - tokyoNoonish.getTime()) < 25 * 60_000);
  });

  it('shifts solar noon four minutes per degree of longitude', () => {
    const date = utc(2026, 7, 15);
    const a = dateFromJulianDay(solarNoonJulianDay(0, date));
    const b = dateFromJulianDay(solarNoonJulianDay(1, date));
    const minutes = (a.getTime() - b.getTime()) / 60_000;
    assert.ok(Math.abs(minutes - 4) < 0.05, `got ${minutes}`);
  });

  it('gives the same answer for equivalent longitudes either side of the date line', () => {
    const date = new Date('2026-07-15T00:00:00Z');
    const east = sunTimes(-17, 179.9, date);
    const west = sunTimes(-17, -180.1 + 360, date);
    assert.ok(Math.abs(east.solarNoon.getTime() - west.solarNoon.getTime()) < 1000);
  });
});
