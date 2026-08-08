import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { airQualityUrl, aodAt, parseAirQuality } from './air.ts';

const HOUR = 3_600_000;
const START = Date.parse('2026-08-07T00:00:00Z');

/** A response shaped the way Open-Meteo's air-quality host really answers. */
const body = (depths: Array<number | null>) => ({
  latitude: 56,
  longitude: -3.2,
  hourly: {
    time: depths.map((_, i) => new Date(START + i * HOUR).toISOString().slice(0, 16)),
    aerosol_optical_depth: depths,
  },
});

describe('parsing an aerosol forecast', () => {
  it('reads the hours as UTC instants', () => {
    const report = parseAirQuality(body([0.1, 0.2, 0.3]), 1000);
    assert.equal(report.hours.length, 3);
    // The timestamps arrive naive. Read as local they would be hours out, and
    // silently so — the failure this shares with the forecast parser.
    assert.equal(report.hours[0].time, START);
    assert.equal(report.hours[2].time, START + 2 * HOUR);
    assert.equal(report.fetchedAt, 1000);
  });

  it('survives a body with nothing in it', () => {
    for (const junk of [null, undefined, {}, { hourly: {} }, { hourly: { time: 'no' } }]) {
      const report = parseAirQuality(junk, 0);
      assert.deepEqual(report.hours, []);
      assert.equal(aodAt(report, START), null);
    }
  });

  it('keeps a gap as a gap rather than as zero', () => {
    // Nought is a real and very clear sky; missing is not knowing. Collapsing
    // one into the other would report an alpine day over a dust storm.
    const report = parseAirQuality(body([null, 0.4]), 0);
    assert.equal(report.hours[0].aod550, null);
    assert.equal(aodAt(report, START), 0.4, 'and skips to the hour that has one');
  });
});

describe('reading the depth at an instant', () => {
  const report = parseAirQuality(body([0.1, 0.5, 0.9]), 0);

  it('takes the nearest hour, either side', () => {
    assert.equal(aodAt(report, START + 5 * 60_000), 0.1);
    assert.equal(aodAt(report, START + 55 * 60_000), 0.5, 'nearest, not the one before');
    assert.equal(aodAt(report, START + 2 * HOUR + 10 * 60_000), 0.9);
  });

  it('refuses past the end of the forecast rather than clamping', () => {
    // A colour temperature from last week's dust would look exactly as
    // authoritative as one from today's.
    assert.equal(aodAt(report, START + 12 * HOUR), null);
    assert.equal(aodAt(report, START - 12 * HOUR), null);
  });

  it('has no reading at all when there is no report', () => {
    assert.equal(aodAt(null, START), null);
    assert.equal(aodAt(undefined, START), null);
  });
});

describe('the request', () => {
  it('asks the air-quality host for the one field, in UTC', () => {
    const url = airQualityUrl(55.9533, -3.1883);
    assert.equal(url.host, 'air-quality-api.open-meteo.com');
    assert.equal(url.searchParams.get('hourly'), 'aerosol_optical_depth');
    assert.equal(url.searchParams.get('timezone'), 'UTC');
    // Four decimals: the same rounding the forecast request uses.
    assert.equal(url.searchParams.get('latitude'), '55.9533');
  });
});
