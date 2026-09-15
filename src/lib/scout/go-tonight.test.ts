import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { bestGoTonight, evaluateGoTonight, gatePointFor, type GoTonightOpportunity } from './go-tonight.ts';
import { distance } from './geo.ts';
import { horizonSampleDistanceM } from './weather.ts';
import type { WeatherHour, WeatherReport } from './weather.ts';
import type { SavedSpot } from './spots.ts';

const CALTON = { lat: 55.9553, lon: -3.1817 };
const FROM = new Date('2026-01-01T00:00:00Z');

const spot = (name: string, bearing: number | null = 270): SavedSpot => ({
  name,
  lat: CALTON.lat,
  lon: CALTON.lon,
  savedAt: Date.parse('2026-01-01T00:00:00.000Z'),
  frame:
    bearing == null
      ? undefined
      : { sensor: 'full-frame', focalLengthMm: 35, orientation: 'landscape', bearing, tiltDeg: 0 },
});

/** A flat forecast: every hour in range carries the same cloud reading. */
function reportAround(at: Date, cover: { low: number; mid: number; high: number }): WeatherReport {
  const hours: WeatherHour[] = [];
  for (let h = -2; h <= 2; h++) {
    hours.push({
      time: at.getTime() + h * 3_600_000,
      temperatureC: 10,
      dewPointC: 5,
      cloudCover: Math.max(cover.low, cover.mid, cover.high),
      cloudLow: cover.low,
      cloudMid: cover.mid,
      cloudHigh: cover.high,
      precipitationChance: 0,
      weatherCode: 0,
      visibilityM: 20000,
      windSpeedKmh: null,
      windGustKmh: null,
    });
  }
  return { latitude: CALTON.lat, longitude: CALTON.lon, fetchedAt: Date.now(), current: null, hours };
}

describe('evaluateGoTonight', () => {
  it('refuses a spot with no kept bearing rather than inventing one', () => {
    const result = evaluateGoTonight(spot('no-frame', null), 'sun', FROM, null, null);
    assert.equal(result, null);
  });

  it('finds a real alignment, unweathered, when no forecast is supplied', () => {
    const result = evaluateGoTonight(spot('Calton Hill'), 'sun', FROM, null, null);
    assert.ok(result);
    assert.equal(result!.directLightFraction, null);
    assert.equal(result!.horizon, null);
    assert.equal(result!.confirmed, false);
    assert.match(result!.note, /too far out for a forecast yet/);
  });

  it('confirms only when the horizon reads lit or bare, not merely forecast', () => {
    const result = evaluateGoTonight(spot('Calton Hill'), 'sun', FROM, null, null);
    assert.ok(result);
    const at = result!.alignment.best.at;
    const clearEverywhere = reportAround(at, { low: 2, mid: 2, high: 2 });
    const confirmed = evaluateGoTonight(spot('Calton Hill'), 'sun', FROM, clearEverywhere, clearEverywhere);
    assert.ok(confirmed);
    assert.equal(confirmed!.confirmed, true);
    assert.ok(['lit', 'bare'].includes(confirmed!.horizon!.verdict));

    const blockedAtGate = reportAround(at, { low: 90, mid: 90, high: 20 });
    const unconfirmed = evaluateGoTonight(spot('Calton Hill'), 'sun', FROM, clearEverywhere, blockedAtGate);
    assert.ok(unconfirmed);
    assert.equal(unconfirmed!.confirmed, false);
    assert.equal(unconfirmed!.horizon!.verdict, 'blocked');
  });
});

describe('bestGoTonight', () => {
  const base: GoTonightOpportunity = {
    spot: spot('a'),
    body: 'sun',
    alignment: {
      best: { at: new Date('2026-06-01'), altitude: 0, angularRadius: 0.27, descending: true, clearanceDeg: 0 },
      window: [],
      meets: true,
      passesBehind: true,
      descending: true,
      atSearchEdge: null,
      note: '',
    },
    directLightFraction: 0.9,
    horizon: {
      verdict: 'lit',
      gateCover: 5,
      canvasCover: 30,
      bearing: 270,
      distanceM: 300_000,
      note: '',
    },
    confirmed: true,
    note: '',
  };

  it('is null when nothing is confirmed', () => {
    const unconfirmed = { ...base, confirmed: false, horizon: { ...base.horizon!, verdict: 'blocked' as const } };
    assert.equal(bestGoTonight([unconfirmed]), null);
  });

  it('picks the soonest confirmed opportunity, ignoring closer unconfirmed ones', () => {
    const soonerUnconfirmed: GoTonightOpportunity = {
      ...base,
      spot: spot('sooner-blocked'),
      confirmed: false,
      alignment: { ...base.alignment, best: { ...base.alignment.best, at: new Date('2026-05-01') } },
    };
    const laterConfirmed: GoTonightOpportunity = {
      ...base,
      spot: spot('later-clear'),
      alignment: { ...base.alignment, best: { ...base.alignment.best, at: new Date('2026-08-01') } },
    };
    const pick = bestGoTonight([soonerUnconfirmed, laterConfirmed]);
    assert.ok(pick);
    assert.equal(pick!.spot.name, 'later-clear');
  });
});

describe('gatePointFor', () => {
  it('lands the standard √(2·R·h) tangent distance away, on the given bearing', () => {
    const gate = gatePointFor(CALTON, 270);
    const expectedM = horizonSampleDistanceM();
    const actualM = distance(CALTON, gate);
    assert.ok(Math.abs(actualM - expectedM) < 1000, `${actualM} vs ${expectedM}`);
  });
});
