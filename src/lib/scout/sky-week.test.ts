import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEARING_STEP, bearingsFor, roundBearing, skyDays, skyMarks } from './sky-week';
import type { WeatherHour, WeatherReport } from './weather';

const LONDON = { lat: 51.5079, lon: -0.0877, tz: 'Europe/London' };

const hour = (time: number, low: number, mid: number, high: number): WeatherHour =>
  ({ time, temperatureC: 12, dewPointC: 8, cloudCover: Math.max(low, mid, high), cloudLow: low, cloudMid: mid, cloudHigh: high } as unknown as WeatherHour);

/** Hourly reports over the days' events, with cloud chosen per day index. */
function reports(days: { when: Date }[], pinCloud: (i: number) => [number, number, number], gateCloud: (i: number) => [number, number, number]) {
  const mk = (f: (i: number) => [number, number, number]): WeatherReport => ({
    latitude: 0, longitude: 0, fetchedAt: 0, current: null,
    hours: days.map((d, i) => hour(Math.round(d.when.getTime() / 3_600_000) * 3_600_000, ...f(i))),
  });
  return { pin: mk(pinCloud), gate: mk(gateCloud) };
}

test('seven sunsets from the day given, each with its own bearing', () => {
  const days = skyDays(LONDON.lat, LONDON.lon, '2026-10-14', LONDON.tz, 'sunset');
  assert.equal(days.length, 7);
  assert.equal(days[0].iso, '2026-10-14');
  assert.equal(days[6].iso, '2026-10-20');
  // Mid-October in London the sun sets in the WSW and swings south about a degree a day.
  assert.ok(days[0].bearing > 245 && days[0].bearing < 260, String(days[0].bearing));
  assert.ok(days[0].bearing > days[6].bearing, 'moving south');
  assert.ok(days.every((d) => d.bearing % BEARING_STEP === 0));
  // 18:09 BST on the 14th.
  assert.equal(days[0].when.toISOString().slice(11, 16), '17:09');
});

test('sunrises come out in the east', () => {
  const days = skyDays(LONDON.lat, LONDON.lon, '2026-10-14', LONDON.tz, 'sunrise', 3);
  assert.ok(days.every((d) => d.bearing > 95 && d.bearing < 115));
});

test('polar night has no sunsets to mark', () => {
  assert.deepEqual(skyDays(78.22, 15.65, '2026-12-21', 'Arctic/Longyearbyen', 'sunset', 3), []);
});

test('neighbouring days share a far sample', () => {
  const days = skyDays(LONDON.lat, LONDON.lon, '2026-10-14', LONDON.tz, 'sunset');
  const bearings = bearingsFor(days);
  assert.ok(bearings.length < days.length && bearings.length >= 2, String(bearings));
});

test('round bearings wrap at north', () => {
  assert.equal(roundBearing(359.4), 0);
  assert.equal(roundBearing(-1.2), 358);
});

test('each day gets the panel’s own verdict, read along its own bearing', () => {
  const days = skyDays(LONDON.lat, LONDON.lon, '2026-10-14', LONDON.tz, 'sunset', 3);
  // Day 0: open horizon, high cloud overhead → lit. Day 1: clear overhead → bare. Day 2: low deck → blocked.
  const { pin, gate } = reports(days, (i) => [[5, 20, 60], [0, 0, 0], [10, 30, 70]][i] as [number, number, number], (i) => [[10, 10, 0], [5, 5, 0], [90, 40, 0]][i] as [number, number, number]);
  const gates = new Map(bearingsFor(days).map((b) => [b, gate]));
  const marks = skyMarks(days, pin, gates, 300_000);
  assert.deepEqual(marks.map((m) => [m.iso, m.verdict]), [['2026-10-14', 'lit'], ['2026-10-15', 'bare'], ['2026-10-16', 'blocked']]);
  assert.match(marks[0].note, /open/);
});

test('past the forecast, or without a far sample, a day gets no mark', () => {
  const days = skyDays(LONDON.lat, LONDON.lon, '2026-10-14', LONDON.tz, 'sunset', 3);
  const { pin, gate } = reports(days.slice(0, 1), () => [5, 20, 60], () => [10, 10, 0]);
  const gates = new Map<number, WeatherReport | null>([[days[0].bearing, gate]]);
  const marks = skyMarks(days, pin, gates, 300_000);
  assert.deepEqual(marks.map((m) => m.iso), ['2026-10-14']);
  assert.deepEqual(skyMarks(days, null, gates, 300_000), []);
});
