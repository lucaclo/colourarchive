import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardApertures, hyperfocalCards } from './cards';
import type { KitEntry } from './kit';

const entry = (over: Partial<KitEntry>): KitEntry => ({
  id: 'x', label: 'a7C II · 35mm', body: 'a7C II', lens: '35mm ƒ/2.8', sensor: 'ff', megapixels: 33,
  focalMin: 35, focalMax: 35, focalUsual: 35, maxAperture: 2.8, count: 1, ...over,
});

test('apertures run from the lens’s widest to ƒ/22', () => {
  assert.deepEqual(cardApertures(2.8), [2.8, 4, 5.6, 8, 11, 16, 22]);
  assert.deepEqual(cardApertures(3.5), [3.5, 4, 5.6, 8, 11, 16, 22]);
});

test('a prime gets one card, a zoom one per marked focal length', () => {
  const cards = hyperfocalCards([entry({}), entry({ id: 'z', label: 'a7C II · 24–50mm', lens: '24–50mm ƒ/2.8', focalMin: 24, focalMax: 50, focalUsual: 50 })]);
  assert.deepEqual(cards.map((c) => c.title), ['a7C II · 35mm', 'a7C II · 24mm', 'a7C II · 28mm', 'a7C II · 35mm', 'a7C II · 40mm', 'a7C II · 50mm']);
});

test('the numbers are the hyperfocal distances in both standards', () => {
  const [card] = hyperfocalCards([entry({})]);
  const f8 = card.rows.find((r) => r.aperture === 8)!;
  // 35mm at ƒ/8, print CoC 43.18/1500 ≈ 0.0288 mm: 35 + 35²/(8 × 0.0288) ≈ 5.35 m.
  assert.ok(Math.abs(f8.printM - 5.35) < 0.03);
  assert.ok(f8.pixelM > f8.printM * 2);
  assert.match(card.detail, /full frame, 33 MP$/);
});
