import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameLightAhead } from './relight';
import { sunPosition } from './sun';

const london = { lat: 51.5, lon: -0.12 };
const day = (d: Date) => d.toISOString().slice(0, 10);

test('a May morning comes back on the next 1 May', () => {
  const taken = new Date('2026-05-01T05:30:00Z');
  const r = sameLightAhead(london.lat, london.lon, taken, new Date('2026-11-01T00:00:00Z'));
  if (r.kind !== 'anniversary') return assert.fail(`expected the anniversary, got ${r.kind}`);
  assert.ok(Math.abs(new Date(r.at).getTime() - new Date('2027-05-01T05:30:00Z').getTime()) < 2 * 86_400_000, day(r.at));
  const then = sunPosition(london.lat, london.lon, taken);
  assert.ok(Math.abs(r.altitude - then.altitude) < 0.01);
  assert.ok(r.missDeg < 1);
});

test('after the anniversary has passed, the mirror date about the solstice comes first', () => {
  const taken = new Date('2026-05-01T05:30:00Z');
  const r = sameLightAhead(london.lat, london.lon, taken, new Date('2027-05-10T00:00:00Z'));
  if (r.kind !== 'mirror') return assert.fail(`expected the mirror date, got ${r.kind}`);
  const d = day(r.at);
  assert.ok(d >= '2027-08-05' && d <= '2027-08-18', d);
  // Morning still: the same side of noon.
  assert.ok(r.azimuth < 180);
});

test('an evening photo matches an evening', () => {
  const taken = new Date('2026-03-01T17:00:00Z');
  const r = sameLightAhead(london.lat, london.lon, taken, new Date('2026-04-01T00:00:00Z'));
  assert.notEqual(r.kind, 'dark');
  if (r.kind !== 'dark') assert.ok(r.azimuth > 180);
});

test('a night photo refuses', () => {
  const r = sameLightAhead(london.lat, london.lon, new Date('2026-01-10T23:00:00Z'), new Date('2026-11-01T00:00:00Z'));
  assert.equal(r.kind, 'dark');
});
