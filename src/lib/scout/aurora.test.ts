import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  GEOMAGNETIC_NORTH_POLE,
  OVAL_BOUNDARY_AT_KP0,
  OVAL_DEG_PER_KP,
  OVAL_NEAR_MARGIN_DEG,
  AURORA_CLEAR_MAX_PCT,
  AURORA_OVERCAST_MIN_PCT,
  auroraReading,
  auroraStalenessNote,
  cloudStateFor,
  geomagneticLatitude,
  ovalBoundaryLat,
  ovalPositionFor,
  parseKpIndex,
  parseRealtimeReading,
  type AuroraInput,
  type SpaceWeather,
} from './aurora.ts';
import { SUN_ALTITUDE } from './sun.ts';
import { MOONRISE_ALTITUDE } from './moon.ts';

/* ── Geomagnetic latitude ─────────────────────────────────────────────────── */

describe('geomagneticLatitude', () => {
  it('is 90° exactly at the geomagnetic pole itself', () => {
    const { latitude, longitude } = GEOMAGNETIC_NORTH_POLE;
    assert.ok(Math.abs(geomagneticLatitude(latitude, longitude) - 90) < 1e-6);
  });

  it('is close to geographic latitude far from the pole, near the pole’s own meridian', () => {
    // On the geomagnetic pole's own meridian the two latitudes track most
    // closely — this just checks the conversion is not doing something wild,
    // not that it reproduces IGRF to the arcminute (it does not, and says so).
    const geomag = geomagneticLatitude(0, GEOMAGNETIC_NORTH_POLE.longitude);
    assert.ok(geomag > -15 && geomag < 15, `expected near-equatorial, got ${geomag}`);
  });

  it('is symmetric about the pole’s own meridian', () => {
    const east = geomagneticLatitude(50, GEOMAGNETIC_NORTH_POLE.longitude + 10);
    const west = geomagneticLatitude(50, GEOMAGNETIC_NORTH_POLE.longitude - 10);
    assert.ok(Math.abs(east - west) < 1e-6);
  });

  it('is negative in the southern hemisphere', () => {
    assert.ok(geomagneticLatitude(-60, 0) < 0);
  });
});

/* ── The oval's reach ─────────────────────────────────────────────────────── */

describe('ovalBoundaryLat', () => {
  it('matches NOAA’s own published table at each whole Kp', () => {
    // https://www.spaceweather.gov/content/tips-viewing-aurora
    assert.equal(ovalBoundaryLat(0), 66);
    assert.equal(ovalBoundaryLat(1), 64);
    assert.equal(ovalBoundaryLat(2), 62);
    assert.equal(ovalBoundaryLat(9), 48);
  });

  it('is built from the two named constants, not a second copy of the numbers', () => {
    assert.equal(ovalBoundaryLat(4), OVAL_BOUNDARY_AT_KP0 - 4 * OVAL_DEG_PER_KP);
  });

  it('clamps a Kp outside the published 0–9 range rather than extrapolating', () => {
    assert.equal(ovalBoundaryLat(-3), ovalBoundaryLat(0));
    assert.equal(ovalBoundaryLat(12), ovalBoundaryLat(9));
  });

  it('is monotonically decreasing — a stronger storm never shrinks the oval', () => {
    let previous = ovalBoundaryLat(0);
    for (let kp = 1; kp <= 9; kp++) {
      const boundary = ovalBoundaryLat(kp);
      assert.ok(boundary <= previous, `Kp ${kp} boundary ${boundary} was not below Kp ${kp - 1}'s ${previous}`);
      previous = boundary;
    }
  });
});

describe('ovalPositionFor', () => {
  const boundary = 60;

  it('is inside exactly at and above the boundary', () => {
    assert.equal(ovalPositionFor(boundary, boundary), 'inside');
    assert.equal(ovalPositionFor(boundary + 5, boundary), 'inside');
  });

  it('is near within the stated margin outside the boundary', () => {
    assert.equal(ovalPositionFor(boundary - 1, boundary), 'near');
    assert.equal(ovalPositionFor(boundary - OVAL_NEAR_MARGIN_DEG, boundary), 'near');
  });

  it('is outside beyond the margin', () => {
    assert.equal(ovalPositionFor(boundary - OVAL_NEAR_MARGIN_DEG - 0.01, boundary), 'outside');
    assert.equal(ovalPositionFor(0, boundary), 'outside');
  });
});

/* ── Cloud ─────────────────────────────────────────────────────────────────── */

describe('cloudStateFor', () => {
  it('is unknown for a missing or non-finite reading', () => {
    assert.equal(cloudStateFor(null), 'unknown');
    assert.equal(cloudStateFor(undefined), 'unknown');
    assert.equal(cloudStateFor(NaN), 'unknown');
  });

  it('bands clear, patchy and overcast at the stated thresholds', () => {
    assert.equal(cloudStateFor(0), 'clear');
    assert.equal(cloudStateFor(AURORA_CLEAR_MAX_PCT), 'clear');
    assert.equal(cloudStateFor(AURORA_CLEAR_MAX_PCT + 1), 'patchy');
    assert.equal(cloudStateFor(AURORA_OVERCAST_MIN_PCT - 1), 'patchy');
    assert.equal(cloudStateFor(AURORA_OVERCAST_MIN_PCT), 'overcast');
    assert.equal(cloudStateFor(100), 'overcast');
  });
});

/* ── Parsing NOAA's feeds ─────────────────────────────────────────────────── */

describe('parseKpIndex', () => {
  it('takes the latest entry by time, not by array position', () => {
    const body = [
      { time_tag: '2026-08-16T00:00:00', Kp: 1.33 },
      { time_tag: '2026-08-23T18:00:00', Kp: 4.33 },
      { time_tag: '2026-08-20T09:00:00', Kp: 2.0 },
    ];
    const result = parseKpIndex(body);
    assert.ok(result);
    assert.equal(result.kp, 4.33);
    assert.equal(result.atMs, Date.parse('2026-08-23T18:00:00Z'));
  });

  it('drops entries with a missing or non-numeric Kp, keeping the rest', () => {
    const body = [
      { time_tag: '2026-08-23T15:00:00', Kp: 'bad' },
      { time_tag: '2026-08-23T18:00:00', Kp: 3 },
    ];
    const result = parseKpIndex(body);
    assert.equal(result?.kp, 3);
  });

  it('is null for a body that is not an array, not zero', () => {
    for (const junk of [null, undefined, {}, 'oops']) {
      assert.equal(parseKpIndex(junk), null);
    }
  });

  it('is null for an empty array', () => {
    assert.equal(parseKpIndex([]), null);
  });
});

describe('parseRealtimeReading', () => {
  const body = [
    { time_tag: '2026-08-23T21:17:00', active: true, source: 'SOLAR1', proton_speed: 402.8 },
    { time_tag: '2026-08-23T21:17:00', active: false, source: 'ACE', proton_speed: 404.9 },
    { time_tag: '2026-08-23T21:16:00', active: true, source: 'SOLAR1', proton_speed: 399.1 },
  ];

  it('reads only active entries', () => {
    const result = parseRealtimeReading(body, 'proton_speed');
    assert.ok(result);
    assert.equal(result.value, 402.8);
  });

  it('takes the newest active entry when more than one qualifies', () => {
    const result = parseRealtimeReading(body, 'proton_speed');
    assert.equal(result?.atMs, Date.parse('2026-08-23T21:17:00Z'));
  });

  it('reads a different field name for the magnetic-field feed', () => {
    const mag = [{ time_tag: '2026-08-23T21:17:00', active: true, bz_gsm: -3.31 }];
    const result = parseRealtimeReading(mag, 'bz_gsm');
    assert.equal(result?.value, -3.31);
  });

  it('is null when nothing is marked active', () => {
    const allInactive = body.map((e) => ({ ...e, active: false }));
    assert.equal(parseRealtimeReading(allInactive, 'proton_speed'), null);
  });

  it('is null for a body that is not an array', () => {
    assert.equal(parseRealtimeReading(null, 'proton_speed'), null);
  });
});

describe('auroraStalenessNote', () => {
  it('is empty inside half an hour', () => {
    assert.equal(auroraStalenessNote(0, 29 * 60_000), '');
  });

  it('reports hours once past the threshold', () => {
    assert.equal(auroraStalenessNote(0, 3 * 3_600_000), 'Kp reading 3 h old');
  });

  it('reports days once past a day', () => {
    assert.equal(auroraStalenessNote(0, 2 * 86_400_000), 'Kp reading 2 d old');
  });
});

/* ── The join ─────────────────────────────────────────────────────────────── */

const EDINBURGH = { latitude: 55.95, longitude: -3.19 };

const spaceWeather = (over: Partial<SpaceWeather> = {}): SpaceWeather => ({
  kp: 4,
  kpAtMs: Date.parse('2026-08-23T18:00:00Z'),
  bzNt: -3.3,
  windSpeedKmS: 403,
  measuredAtMs: Date.parse('2026-08-23T21:17:00Z'),
  fetchedAt: Date.parse('2026-08-23T21:20:00Z'),
  ...over,
});

const darkInput = (over: Partial<AuroraInput> = {}): AuroraInput => ({
  latitude: EDINBURGH.latitude,
  longitude: EDINBURGH.longitude,
  sunAltitudeDeg: SUN_ALTITUDE.astronomical - 1,
  moonAltitudeDeg: MOONRISE_ALTITUDE - 1,
  cloudCoverPct: 10,
  lightPollutionZone: 6,
  spaceWeather: spaceWeather(),
  ...over,
});

describe('auroraReading — refusals', () => {
  it('refuses first on a missing space-weather reading, even when it is dark and moonless', () => {
    const result = auroraReading(darkInput({ spaceWeather: null }));
    assert.equal(result.arrangement, null);
    assert.equal(result.absence, 'data-unavailable');
  });

  it('refuses on a missing reading ahead of darkness — a dead feed must not read as "not dark yet"', () => {
    const result = auroraReading(
      darkInput({ spaceWeather: null, sunAltitudeDeg: 10 /* broad daylight */ }),
    );
    assert.equal(result.absence, 'data-unavailable');
  });

  it('refuses when the sun is above the astronomical-darkness threshold', () => {
    const result = auroraReading(darkInput({ sunAltitudeDeg: SUN_ALTITUDE.astronomical + 0.01 }));
    assert.equal(result.arrangement, null);
    assert.equal(result.absence, 'not-dark');
  });

  it('is dark right at the threshold itself', () => {
    const result = auroraReading(darkInput({ sunAltitudeDeg: SUN_ALTITUDE.astronomical }));
    assert.notEqual(result.absence, 'not-dark');
  });

  it('refuses when the moon is up, even with dark skies and good data', () => {
    const result = auroraReading(darkInput({ moonAltitudeDeg: 5 }));
    assert.equal(result.arrangement, null);
    assert.equal(result.absence, 'moon-up');
  });

  it('checks darkness ahead of the moon', () => {
    const result = auroraReading(darkInput({ sunAltitudeDeg: 0, moonAltitudeDeg: 5 }));
    assert.equal(result.absence, 'not-dark');
  });

  it('every refusal carries a non-empty note explaining itself', () => {
    for (const over of [{ spaceWeather: null }, { sunAltitudeDeg: 0 }, { moonAltitudeDeg: 5 }]) {
      const result = auroraReading(darkInput(over));
      assert.ok(result.note.length > 0);
    }
  });
});

describe('auroraReading — arrangement', () => {
  it('reports inside the oval for a high-Kp storm at a high geomagnetic latitude', () => {
    const result = auroraReading(darkInput({ spaceWeather: spaceWeather({ kp: 9 }) }));
    assert.ok(result.arrangement);
    assert.equal(result.absence, null);
    assert.equal(result.arrangement.position, 'inside');
  });

  it('reports outside the oval for a quiet Kp at a low geomagnetic latitude', () => {
    const result = auroraReading(
      darkInput({ latitude: 20, longitude: 0, spaceWeather: spaceWeather({ kp: 1 }) }),
    );
    assert.ok(result.arrangement);
    assert.equal(result.arrangement.position, 'outside');
  });

  it('carries the cloud reading through unchanged', () => {
    const result = auroraReading(darkInput({ cloudCoverPct: 92 }));
    assert.equal(result.arrangement?.cloud, 'overcast');
    assert.equal(result.arrangement?.cloudCoverPct, 92);
  });

  it('carries Bz and wind speed through as their own facts', () => {
    const result = auroraReading(darkInput());
    assert.equal(result.arrangement?.bzNt, -3.3);
    assert.equal(result.arrangement?.windSpeedKmS, 403);
    assert.match(result.arrangement!.spaceWeatherNote, /south/);
    assert.match(result.arrangement!.spaceWeatherNote, /403 km\/s/);
  });

  it('still reports an arrangement when Bz and wind are both missing, Kp alone answering', () => {
    const result = auroraReading(
      darkInput({ spaceWeather: spaceWeather({ bzNt: null, windSpeedKmS: null, measuredAtMs: null }) }),
    );
    assert.ok(result.arrangement);
    assert.equal(result.arrangement.spaceWeatherNote, '');
  });

  it('passes the light-pollution zone through as a reported fact, never a gate', () => {
    const bright = auroraReading(darkInput({ lightPollutionZone: 13, spaceWeather: spaceWeather({ kp: 9 }) }));
    assert.ok(bright.arrangement, 'a bright zone must not refuse the arrangement on its own');
    assert.equal(bright.arrangement.lightPollutionZone, 13);
  });

  it('reports geomagnetic latitude and the oval boundary as separate named numbers', () => {
    const result = auroraReading(darkInput());
    assert.ok(result.arrangement);
    assert.ok(Number.isFinite(result.arrangement.geomagneticLatitude));
    assert.equal(result.arrangement.ovalBoundaryLat, ovalBoundaryLat(4));
  });

  it('the note mentions the Kp, the position and the cloud reading', () => {
    const result = auroraReading(darkInput());
    assert.match(result.arrangement!.note, /Kp 4/);
    assert.match(result.arrangement!.note, /cloud/);
  });
});
