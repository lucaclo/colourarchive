import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStack, focusForNear, groundNearPoint, planStack, stackText } from './stack';
import { depthOfField, hyperfocalDistanceMm } from './frame';

const px = 0.0118; // two pixels on a 33 MP full-frame sensor

test('focusForNear inverts the near limit exactly', () => {
  for (const near of [0.5, 1, 2.5]) {
    const s = focusForNear(24, 11, px, near)!;
    assert.ok(Math.abs(depthOfField(24, 11, px, s).nearM - near) < 1e-9);
  }
  // Past the hyperfocal reach there is no such focus.
  const H = hyperfocalDistanceMm(24, 11, px) / 1000;
  assert.equal(focusForNear(24, 11, px, H), null);
});

test('a stack to infinity starts at the near point, overlaps, and ends at hyperfocal', () => {
  const plan = planStack({ focalLengthMm: 24, aperture: 11, circleOfConfusionMm: px, nearM: 0.6, farM: Infinity });
  const H = hyperfocalDistanceMm(24, 11, px) / 1000;
  assert.ok(plan.complete);
  assert.ok(plan.frames.length >= 3);
  assert.ok(Math.abs(plan.frames[0].nearM - 0.6) < 1e-9);
  for (let i = 1; i < plan.frames.length; i++) {
    // Each zone starts inside the one before it.
    assert.ok(plan.frames[i].nearM < plan.frames[i - 1].farM);
    assert.ok(plan.frames[i].focusM > plan.frames[i - 1].focusM);
  }
  const last = plan.frames[plan.frames.length - 1];
  assert.equal(last.farM, Infinity);
  assert.ok(Math.abs(last.focusM - H) < 1e-9);
});

test('a finite range stops as soon as it is covered, and a short one needs one frame', () => {
  const plan = planStack({ focalLengthMm: 24, aperture: 8, circleOfConfusionMm: px, nearM: 0.5, farM: 2 });
  assert.ok(plan.complete);
  assert.ok(plan.frames.length >= 2);
  assert.ok(plan.frames[plan.frames.length - 1].farM >= 2);
  assert.ok(plan.frames[plan.frames.length - 2].farM < 2);
  const one = planStack({ focalLengthMm: 16, aperture: 11, circleOfConfusionMm: 0.029, nearM: 2, farM: Infinity });
  assert.ok(one.single);
  assert.match(describeStack(one), /^No stack needed: one frame at/);
  assert.equal(describeStack(plan), '');
});

test('more overlap costs more frames; a cap is said out loud', () => {
  const base = { focalLengthMm: 50, aperture: 5.6, circleOfConfusionMm: px, nearM: 0.5, farM: Infinity, maxFrames: 400 };
  assert.ok(planStack({ ...base, overlap: 0.3 }).frames.length > planStack({ ...base, overlap: 0 }).frames.length);
  const capped = planStack({ ...base, maxFrames: 3 });
  assert.equal(capped.frames.length, 3);
  assert.equal(capped.complete, false);
  assert.match(describeStack(capped), /^3 frames and still short/);
});

test('the plan as text has one numbered line per frame', () => {
  const plan = planStack({ focalLengthMm: 24, aperture: 11, circleOfConfusionMm: px, nearM: 0.6, farM: Infinity });
  const text = stackText(plan, '24mm ƒ/11, pixel-sharp', 'Zermatt');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Focus stack · Zermatt');
  assert.equal(lines.length, plan.frames.length + 2);
  assert.match(lines.at(-1)!, /–∞\)$/);
});

test('on flat ground the bottom edge meets it at height over tan(dip)', () => {
  const g = groundNearPoint(1.5, 0, 53.1, () => 0);
  assert.equal(g.kind, 'ground');
  const expected = 1.5 / Math.tan((53.1 / 2) * Math.PI / 180);
  assert.ok(Math.abs((g as { distanceM: number }).distanceM - expected) < 0.01);
  // Tilting down brings it closer; tilting the edge above level never meets it.
  const down = groundNearPoint(1.5, -15, 53.1, () => 0) as { distanceM: number };
  assert.ok(down.distanceM < expected);
  assert.equal(groundNearPoint(1.5, 30, 53.1, () => 0).kind, 'sky');
});

test('rising ground meets the edge sooner, falling ground later or not at all', () => {
  const flat = (groundNearPoint(1.5, 0, 20, () => 0) as { distanceM: number }).distanceM;
  const up = (groundNearPoint(1.5, 0, 20, (d) => d * 0.1) as { distanceM: number }).distanceM;
  assert.ok(up < flat);
  assert.equal(groundNearPoint(1.5, 0, 20, (d) => -d * 0.5).kind, 'none');
});
