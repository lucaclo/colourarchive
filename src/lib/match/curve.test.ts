import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { curveLut, evalSpline, keepMonotone, readLut, worstDip } from './curve';

// Ground truth: Lightroom's own exports of a gray ramp under known curves.
// See lr-data/README.md for where the file comes from.
const rows: number[][][] = JSON.parse(
  fs.readFileSync(new URL('./lr-data/lightroom-point-curves.json', import.meta.url), 'utf8'),
);
const gray = rows.slice(0, 32);
const S = [{ x: 0, y: 0 }, { x: 48, y: 24 }, { x: 128, y: 142 }, { x: 200, y: 224 }, { x: 255, y: 255 }];
const CLIPPED = [{ x: 32, y: 16 }, { x: 96, y: 120 }, { x: 200, y: 224 }];

/** Mean and worst error, in 8-bit levels, of a curve model against Lightroom. */
function errorAgainstLightroom(column: number, f: (x: number) => number) {
  let sum = 0;
  let worst = 0;
  for (const r of gray) {
    const input = r[0][0] / 65535; // Lightroom's identity render of the same pixel
    const real = r[column][0] / 65535;
    const e = Math.abs(f(input * 255) / 255 - real) * 255;
    sum += e;
    worst = Math.max(worst, e);
  }
  return { mean: sum / gray.length, worst };
}

describe('curve: Lightroom’s point curve', () => {
  it('matches Lightroom’s S curve to a hundredth of a level', () => {
    const e = errorAgainstLightroom(1, (x) => evalSpline(S, x));
    assert.ok(e.mean < 0.05 && e.worst < 0.1, JSON.stringify(e));
  });

  it('matches Lightroom’s curve with lifted ends, flat beyond the end points', () => {
    const e = errorAgainstLightroom(3, (x) => evalSpline(CLIPPED, x));
    assert.ok(e.mean < 0.05 && e.worst < 0.1, JSON.stringify(e));
  });

  it('straight lines between points were measurably wrong (why this file exists)', () => {
    const linear = (x: number) => {
      let i = 0;
      while (i < S.length - 2 && S[i + 1].x < x) i++;
      const a = S[i], b = S[i + 1];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    };
    assert.ok(errorAgainstLightroom(1, linear).mean > 2);
  });

  it('passes through its points and is identity for an identity curve', () => {
    for (const p of S) assert.ok(Math.abs(evalSpline(S, p.x) - p.y) < 1e-9);
    for (const x of [0, 17, 128, 254]) assert.equal(evalSpline([{ x: 0, y: 0 }, { x: 255, y: 255 }], x), x);
  });

  it('the LUT reads back the spline', () => {
    const lut = curveLut(S);
    for (const x of [0, 30, 100, 128, 222, 255]) {
      assert.ok(Math.abs(readLut(lut, x / 255) * 255 - evalSpline(S, x)) < 0.01);
    }
  });

  it('keepMonotone removes a dip without moving the end points', () => {
    // Monotone points, but a steep run next to a flat one makes the spline fall back.
    const bumpy = [{ x: 0, y: 0 }, { x: 40, y: 120 }, { x: 60, y: 122 }, { x: 200, y: 128 }, { x: 255, y: 255 }];
    assert.ok(worstDip(bumpy) > 1, 'the fixture really does dip');
    const fixed = keepMonotone(bumpy);
    assert.ok(worstDip(fixed) <= 0.25);
    assert.equal(fixed[0].y, 0);
    assert.equal(fixed[fixed.length - 1].y, 255);
  });

  it('keepMonotone leaves an already-monotone curve alone', () => {
    assert.deepEqual(keepMonotone(S), S);
  });
});
