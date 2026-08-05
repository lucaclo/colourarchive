import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DomeGeometry,
  LINE_STRIDE,
  POINT_STRIDE,
  mergeDomeGeometry,
  type DomeVertex,
} from './dome-layer.ts';

/**
 * A stand-in for the page's projector.
 *
 * Answers in both height units the way the real one does, but with numbers that
 * can be read straight back: mercator z is metres/1000, so a vertex that has
 * swapped its two heights is obvious rather than merely wrong.
 */
const project = (lon: number, lat: number, altitudeM: number): DomeVertex => [
  lon,
  lat,
  altitudeM / 1000,
  altitudeM,
];

const point = (lon: number, lat: number, altitudeM: number) => ({ lon, lat, altitudeM });

/**
 * Compare a run of floats that has been through a `Float32Array`.
 *
 * A tenth is not representable in 32 bits — it comes back as 0.10000000149 —
 * and asserting on the exact bits would be testing the IEEE spec rather than
 * the packing.
 */
const near = (actual: Float32Array, expected: number[], what = 'slot') => {
  assert.equal(actual.length, expected.length, `${what}: wrong number of floats`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) < 1e-6,
      `${what} ${i}: ${actual[i]} is not ${expected[i]}`,
    );
  }
};

describe('DomeGeometry packing', () => {
  it('carries both heights on every line vertex', () => {
    const geometry = new DomeGeometry(project);
    geometry.push([point(1, 2, 500), point(3, 4, 250)], 'strip', [1, 0, 0, 1]);
    const { lines } = geometry.data();

    assert.equal(lines.length, 2 * LINE_STRIDE);
    // x, y, mercator z, metres — then the colour.
    assert.deepEqual(Array.from(lines.slice(0, 4)), [1, 2, 0.5, 500]);
    assert.deepEqual(Array.from(lines.slice(LINE_STRIDE, LINE_STRIDE + 4)), [3, 4, 0.25, 250]);
    assert.deepEqual(Array.from(lines.slice(4, 8)), [1, 0, 0, 1]);
  });

  it('carries both heights on every point, with size and glow after the colour', () => {
    const geometry = new DomeGeometry(project);
    geometry.push([point(5, 6, 1000)], 'points', [0, 1, 0, 0.5], 12, 3);
    const { points } = geometry.data();

    assert.equal(points.length, POINT_STRIDE);
    assert.deepEqual(Array.from(points), [5, 6, 1, 1000, 0, 1, 0, 0.5, 12, 3]);
  });

  it('paints a strip with the colour of each vertex in turn', () => {
    const geometry = new DomeGeometry(project);
    const points = [point(0, 0, 0), point(1, 1, 0), point(2, 2, 0)];
    geometry.push(points, 'strip', (i) => [i / 4, 0, 0, 1]);
    const { lines } = geometry.data();

    for (let i = 0; i < points.length; i++) {
      assert.equal(lines[i * LINE_STRIDE + 4], i / 4);
    }
  });

  it('records one run per path, so two paths are never joined', () => {
    const geometry = new DomeGeometry(project);
    geometry.push([point(0, 0, 0), point(1, 0, 0)], 'strip', [1, 1, 1, 1]);
    geometry.push([point(5, 5, 0), point(6, 5, 0)], 'strip', [1, 1, 1, 1]);
    const { runs } = geometry.data();

    assert.deepEqual(runs, [
      { offset: 0, count: 2 },
      { offset: 2, count: 2 },
    ]);
  });

  it('lays a sprite along a wide path and none along a hairline', () => {
    const wide = new DomeGeometry(project);
    wide.push([point(0, 0, 0), point(1, 1, 0)], 'strip', [1, 1, 1, 1], 4);
    assert.equal(wide.data().points.length, 2 * POINT_STRIDE);

    const hair = new DomeGeometry(project);
    hair.push([point(0, 0, 0), point(1, 1, 0)], 'strip', [1, 1, 1, 1], 1);
    assert.equal(hair.data().points.length, 0);
  });
});

describe('mergeDomeGeometry', () => {
  it('shifts the minute run offsets past the day, in whole vertices', () => {
    const day = new DomeGeometry(project);
    day.push([point(0, 0, 0), point(1, 0, 0), point(2, 0, 0)], 'strip', [1, 1, 1, 1]);

    const minute = new DomeGeometry(project);
    minute.push([point(9, 9, 100), point(8, 8, 100)], 'strip', [0, 0, 1, 1]);

    const merged = mergeDomeGeometry(day.data(), minute.data());

    assert.equal(merged.lines.length, 5 * LINE_STRIDE);
    assert.deepEqual(merged.runs, [
      { offset: 0, count: 3 },
      // Three vertices in, not three floats in — the stride is the whole point.
      { offset: 3, count: 2 },
    ]);
    // The minute's first vertex survives the join with both its heights.
    near(merged.lines.slice(3 * LINE_STRIDE, 3 * LINE_STRIDE + 4), [9, 9, 0.1, 100]);
  });

  it('joins the point buffers without disturbing either', () => {
    const day = new DomeGeometry(project);
    day.push([point(1, 1, 10)], 'points', [1, 0, 0, 1], 2, 0);
    const minute = new DomeGeometry(project);
    minute.push([point(2, 2, 20)], 'points', [0, 1, 0, 1], 3, 1);

    const merged = mergeDomeGeometry(day.data(), minute.data());
    assert.equal(merged.points.length, 2 * POINT_STRIDE);
    near(merged.points.slice(0, 4), [1, 1, 0.01, 10]);
    near(merged.points.slice(POINT_STRIDE, POINT_STRIDE + 4), [2, 2, 0.02, 20]);
  });
});
