import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitMatte } from './regions.ts';

test('fitMatte returns one byte per pixel, rows intact', async () => {
  // Top half opaque, bottom half clear: after resizing, every row in the top
  // half must be bright and every row in the bottom dark — the old 3-channel
  // read turned this into every third row.
  const side = 64;
  const alpha = new Uint8Array(side * side);
  for (let y = 0; y < side / 2; y++) alpha.fill(255, y * side, (y + 1) * side);
  const w = 1280 / 10, h = 720 / 10;
  const m = await fitMatte(alpha, side, w, h);
  assert.equal(m.length, w * h);
  const rowMean = (y: number) => m.slice(y * w, (y + 1) * w).reduce((a, b) => a + b, 0) / w;
  for (let y = 0; y < h * 0.4; y++) assert.ok(rowMean(y) > 240, `row ${y} ${rowMean(y)}`);
  for (let y = Math.ceil(h * 0.6); y < h; y++) assert.ok(rowMean(y) < 15, `row ${y} ${rowMean(y)}`);
});
