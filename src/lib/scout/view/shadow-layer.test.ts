import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ShadowGeometry } from './shadow-layer.ts';
import { castShadow, type Ring } from '../shadows.ts';

/**
 * A flat stand-in for the mercator projection.
 *
 * The builder does not care what space it is handed — only that it is the same
 * one the matrix is in — so degrees are as good as mercator for testing the
 * packing, and far easier to read back.
 */
const flat = (lon: number, lat: number): [number, number] => [lon, lat];

const square = (lon = 0, lat = 0, sizeDeg = 0.0002): Ring => [
  [lon, lat],
  [lon + sizeDeg, lat],
  [lon + sizeDeg, lat + sizeDeg],
  [lon, lat + sizeDeg],
  [lon, lat],
];

/** Read the packed shadow array back as vertices. */
const shadowVerts = (data: Float32Array) => {
  const out: Array<{ x: number; y: number; ceiling: number; dark: number }> = [];
  for (let i = 0; i < data.length; i += 4) {
    out.push({ x: data[i], y: data[i + 1], ceiling: data[i + 2], dark: data[i + 3] });
  }
  return out;
};

describe('ShadowGeometry', () => {
  it('fans a closed ring into triangles, dropping the repeated vertex', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 180, 45)!;
    geometry.addShadow(shadow.ring, shadow.ceilings, 0.5);

    // A closed ring of n+1 points is an n-gon, which fans into n-2 triangles.
    const corners = shadow.ring.length - 1;
    assert.equal(shadowVerts(geometry.shadowVertices()).length, (corners - 2) * 3);
  });

  it('carries the ceiling of each vertex through unchanged', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 40, 180, 30)!;
    geometry.addShadow(shadow.ring, shadow.ceilings, 0.5);

    const ceilings = new Set(shadowVerts(geometry.shadowVertices()).map((v) => v.ceiling));
    for (const value of ceilings) {
      assert.ok(
        shadow.ceilings.some((c) => Math.abs(c - value) < 1e-4),
        `${value} was not one of the ring's ceilings`,
      );
    }
    // And the extremes both survive: the wall and the tip.
    const drawn = shadowVerts(geometry.shadowVertices()).map((v) => v.ceiling);
    assert.ok(Math.abs(Math.max(...drawn) - Math.max(...shadow.ceilings)) < 1e-4);
    assert.ok(Math.abs(Math.min(...drawn) - Math.min(...shadow.ceilings)) < 1e-4);
  });

  it('gives every vertex of one shadow the same darkness', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 90, 40)!;
    geometry.addShadow(shadow.ring, shadow.ceilings, 0.37);
    for (const vertex of shadowVerts(geometry.shadowVertices())) {
      assert.ok(Math.abs(vertex.dark - 0.37) < 1e-6);
    }
  });

  it('draws nothing for a shadow with no darkness left in it', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 90, 40)!;
    geometry.addShadow(shadow.ring, shadow.ceilings, 0);
    assert.equal(geometry.shadowVertices().length, 0);
  });

  it('packs blockers as position and height, three floats a vertex', () => {
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(square(), 25);
    const data = geometry.blockerVertices();
    // A square hulls to 4 corners, which fan into 2 triangles.
    assert.equal(data.length, 2 * 3 * 3);
    for (let i = 0; i < data.length; i += 3) assert.equal(data[i + 2], 25);
  });

  it('leaves out a blocker with no height, which can shadow nothing', () => {
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(square(), 0);
    assert.equal(geometry.blockerVertices().length, 0);
  });

  it('hulls a concave footprint rather than fanning it', () => {
    // An L, whose naive fan from the first vertex would spill outside it.
    const ell: Ring = [
      [0, 0],
      [0.0003, 0],
      [0.0003, 0.0001],
      [0.0001, 0.0001],
      [0.0001, 0.0003],
      [0, 0.0003],
      [0, 0],
    ];
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(ell, 12);
    // The hull of an L is a pentagon: the notch vertex is interior to it.
    assert.equal(geometry.blockerVertices().length / 3, (5 - 2) * 3);
  });

  it('accumulates many casters into one pair of arrays', () => {
    const geometry = new ShadowGeometry(flat);
    for (let i = 0; i < 5; i++) {
      const foot = square(i * 0.001);
      const shadow = castShadow(foot, 20, 180, 45)!;
      geometry.addShadow(shadow.ring, shadow.ceilings, 0.5);
      geometry.addBlocker(foot, 20);
    }
    assert.equal(geometry.shadowVertices().length % 4, 0);
    assert.equal(geometry.blockerVertices().length % 3, 0);
    assert.equal(geometry.blockerVertices().length / 3, 5 * 2 * 3);
  });
});
