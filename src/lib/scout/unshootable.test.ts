import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rankUnshootable, CLEAR_ENOUGH_COVER_PCT } from './unshootable.ts';
import type { GapShoot, GapOccurrence } from './gap-shoots.ts';
import type { ColourGap } from '../gaps.ts';
import type { WeatherHour, WeatherReport } from './weather.ts';

const gap = (anchorKey: string, kind: ColourGap['kind'] = 'missing'): ColourGap => ({
  anchorKey,
  anchorName: anchorKey,
  targetHue: 0,
  kind,
  photoCount: 0,
  note: '',
});

const occ = (iso: string): GapOccurrence => ({ at: new Date(iso), azimuth: 180, ascending: false });

const matchedPoint = {
  altitudeDeg: 2,
  environment: { key: 'urban', label: 'city haze', aerosol: { beta: 0.2, alpha: 1.3 }, elevationM: 50 },
  source: 'beam' as const,
  hue: 28,
  chroma: 0.2,
  cct: 3000,
};

const shoot = (anchorKey: string, occurrences: GapOccurrence[], hasMatch = true): GapShoot => ({
  gap: gap(anchorKey),
  match: hasMatch ? { point: matchedPoint, hueDeltaDeg: 1 } : null,
  occurrences,
  note: '',
});

function weatherWith(hours: Array<{ iso: string; cloudCover: number }>): WeatherReport {
  const wh: WeatherHour[] = hours.map((h) => ({
    time: new Date(h.iso).getTime(),
    temperatureC: 10,
    dewPointC: 5,
    cloudCover: h.cloudCover,
    cloudLow: h.cloudCover,
    cloudMid: 0,
    cloudHigh: 0,
    precipitationChance: 0,
    weatherCode: 0,
    visibilityM: 20000,
    windSpeedKmh: null,
    windGustKmh: null,
  }));
  return { latitude: 0, longitude: 0, fetchedAt: Date.now(), current: null, hours: wh };
}

describe('rankUnshootable', () => {
  it('ranks a confirmed-clear gap above one with only a farther, unconfirmed date', () => {
    const clear = shoot('red', [occ('2026-06-01T18:00:00Z')]);
    const unconfirmed = shoot('orange', [occ('2026-05-01T18:00:00Z')]); // sooner, but no weather match below
    const weather = weatherWith([{ iso: '2026-06-01T18:00:00Z', cloudCover: 5 }]);
    const ranked = rankUnshootable([unconfirmed, clear], weather);
    assert.equal(ranked[0].shoot.gap.anchorKey, 'red');
    assert.ok(ranked[0].confirmed);
    assert.equal(ranked[1].shoot.gap.anchorKey, 'orange');
    assert.equal(ranked[1].confirmed, null);
  });

  it('ranks reachable-but-unconfirmed above reachable-nowhere-in-window', () => {
    const withDates = shoot('red', [occ('2026-06-01T18:00:00Z')]);
    const noDates = shoot('orange', []);
    const ranked = rankUnshootable([noDates, withDates], null);
    assert.equal(ranked[0].shoot.gap.anchorKey, 'red');
    assert.equal(ranked[1].shoot.gap.anchorKey, 'orange');
  });

  it('ranks any real recipe above a colour daylight cannot make at all', () => {
    const noMatch = shoot('green', [], false);
    const noDatesButMatched = shoot('orange', []);
    const ranked = rankUnshootable([noMatch, noDatesButMatched], null);
    assert.equal(ranked[0].shoot.gap.anchorKey, 'orange');
    assert.equal(ranked[1].shoot.gap.anchorKey, 'green');
  });

  it('picks the soonest CLEAR occurrence, skipping a cloudier earlier one', () => {
    const cloudyFirst = shoot('red', [occ('2026-06-01T18:00:00Z'), occ('2026-06-02T18:00:00Z')]);
    const weather = weatherWith([
      { iso: '2026-06-01T18:00:00Z', cloudCover: 90 },
      { iso: '2026-06-02T18:00:00Z', cloudCover: 10 },
    ]);
    const ranked = rankUnshootable([cloudyFirst], weather);
    assert.ok(ranked[0].confirmed);
    assert.equal(ranked[0].confirmed!.at.toISOString(), new Date('2026-06-02T18:00:00Z').toISOString());
  });

  it('respects the stated cover threshold exactly at its boundary', () => {
    const atBoundary = shoot('red', [occ('2026-06-01T18:00:00Z')]);
    const weather = weatherWith([{ iso: '2026-06-01T18:00:00Z', cloudCover: CLEAR_ENOUGH_COVER_PCT }]);
    const ranked = rankUnshootable([atBoundary], weather);
    // At the threshold itself, not below it — not confirmed.
    assert.equal(ranked[0].confirmed, null);
  });

  it('with no weather at all, nothing is confirmed but the reachable ranking still holds', () => {
    const withDates = shoot('red', [occ('2026-06-01T18:00:00Z')]);
    const ranked = rankUnshootable([withDates], null);
    assert.equal(ranked[0].confirmed, null);
  });
});
