import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextWindow, planLight, skyAllows, sunMatches, describeWish, type CloudHours } from './light-plan';
import { sunPosition } from './scout/sun';
import type { SavedSpot } from './scout/spots';

const london = (bearing?: number): SavedSpot => ({
  name: 'Waterloo Bridge', lat: 51.5079, lon: -0.1167, timeZone: 'Europe/London', savedAt: 0,
  ...(bearing == null ? {} : { frame: { sensor: 'ff', focalLengthMm: 35, orientation: 'landscape', bearing, tiltDeg: 0 } }),
} as SavedSpot);

const from = new Date('2026-11-03T00:00:00Z');

test('golden hour at a spot with no aim: the evening window, aim flagged unknown', () => {
  const w = nextWindow(london(), { phase: 'golden', direction: 'back' }, from, 2);
  assert.ok(w);
  const alt = sunPosition(51.5079, -0.1167, w.start).altitude;
  assert.ok(alt > 0 && alt <= 6, `altitude ${alt}`);
  assert.equal(w.aimUnknown, true);
  assert.equal(w.noForecast, true);
});

test('backlit means the sun in front of the camera: aiming west catches the evening, east the morning', () => {
  const west = nextWindow(london(240), { phase: 'golden', direction: 'back' }, from, 2)!;
  const east = nextWindow(london(120), { phase: 'golden', direction: 'back' }, from, 2)!;
  assert.ok(west.start.getUTCHours() >= 14, `west ${west.start.toISOString()}`);
  assert.ok(east.start.getUTCHours() <= 9, `east ${east.start.toISOString()}`);
  assert.equal(west.aimUnknown, false);
});

test('cloud closes a window and the next clear one is found', () => {
  const clear = nextWindow(london(), { phase: 'golden', direction: null }, from, 3)!;
  const cloud: CloudHours = new Map();
  // Cloud over the whole first day.
  for (let h = 0; h < 24; h++) cloud.set(from.getTime() + h * 3_600_000, 95);
  for (let h = 24; h < 72; h++) cloud.set(from.getTime() + h * 3_600_000, 10);
  const later = nextWindow(london(), { phase: 'golden', direction: null }, from, 3, cloud)!;
  assert.ok(later.start.getTime() >= from.getTime() + 24 * 3_600_000);
  assert.ok(later.start > clear.start);
  assert.equal(later.noForecast, false);
});

test('skyAllows and sunMatches state their rules', () => {
  assert.equal(skyAllows('golden', undefined), null);
  assert.equal(skyAllows('overcast', 90), true);
  assert.equal(skyAllows('golden', 90), false);
  assert.equal(sunMatches('midday', 18, 20), true, 'near the day\'s highest in winter');
  assert.equal(sunMatches('blue', -5, 30), true);
  assert.equal(sunMatches('night', -20, 30), true);
});

test('planLight sorts the soonest first and keeps one per spot', () => {
  const spots = [london(240), london(120)];
  const plan = planLight(spots, { phase: 'golden', direction: 'back' }, from, 2);
  assert.equal(plan.length, 2);
  assert.ok(plan[0].start <= plan[1].start);
  assert.equal(describeWish({ phase: 'golden', direction: 'back' }), 'Golden hour · backlit');
});
