import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, findPrints, minAreaRect, readingOrder, sampleRect, type Raster } from './detect';

/** A dark floor with white rotated rectangles, each holding a dark photo. */
function floor(width: number, height: number, prints: { cx: number; cy: number; w: number; h: number; deg: number }[]): Raster {
  const data = new Uint8Array(width * height * 3).fill(60);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    for (const p of prints) {
      const a = (p.deg * Math.PI) / 180;
      const u = (x - p.cx) * Math.cos(a) + (y - p.cy) * Math.sin(a), v = -(x - p.cx) * Math.sin(a) + (y - p.cy) * Math.cos(a);
      if (Math.abs(u) <= p.w / 2 && Math.abs(v) <= p.h / 2) {
        const inside = Math.abs(u) < p.w * 0.4 && Math.abs(v) < p.h * 0.3;
        data.fill(inside ? 30 : 245, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
  }
  return { data, width, height, channels: 3 };
}

test('minAreaRect finds a rotated rectangle', () => {
  const pts: [number, number][] = [];
  const a = (10 * Math.PI) / 180;
  for (let u = -40; u <= 40; u++) for (const v of [-20, 20]) pts.push([100 + u * Math.cos(a) - v * Math.sin(a), 80 + u * Math.sin(a) + v * Math.cos(a)]);
  const r = minAreaRect(pts);
  assert.ok(Math.abs(r.angle - a) < 0.02);
  assert.ok(Math.abs(r.w - 81) < 2 && Math.abs(r.h - 41) < 2);
});

test('findPrints and readingOrder: rows top to bottom, each left to right', () => {
  const ras = floor(400, 300, [
    { cx: 300, cy: 70, w: 80, h: 100, deg: 6 },
    { cx: 90, cy: 80, w: 80, h: 100, deg: -8 },
    { cx: 200, cy: 210, w: 80, h: 100, deg: 3 },
    { cx: 80, cy: 220, w: 80, h: 100, deg: 0 },
    { cx: 190, cy: 75, w: 80, h: 100, deg: 12 },
  ]);
  const rects = findPrints(ras);
  assert.equal(rects.length, 5);
  const order = readingOrder(rects).map((o) => Math.round(rects[o.index].cx / 10) * 10);
  assert.deepEqual(order, [90, 190, 300, 80, 200]);
  const crop = sampleRect(ras, rects[0], 40, { inset: 0.15 });
  assert.ok(crop.width === 40 && crop.height > 30);
});

test('applyOrder fills the read photos’ places in the floor’s order', () => {
  assert.deepEqual(applyOrder(['a', 'b', 'c', 'd', 'e'], ['d', 'b', 'x']), ['a', 'd', 'c', 'b', 'e']);
  assert.deepEqual(applyOrder(['a', 'b'], []), ['a', 'b']);
});
