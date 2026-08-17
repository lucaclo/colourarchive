import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ShadowGeometry } from './shadow-layer.ts';
import { castShadow, type Ring } from '../shadows.ts';
import type { TerrainFacet } from '../terrain.ts';

/**
 * A flat stand-in for the mercator projection.
 *
 * The builder does not care what space it is handed — only that it is the same
 * one the matrix is in — so degrees are as good as mercator for testing the
 * packing, and far easier to read back. The elevation is echoed straight into
 * the "mercatorZ" slot rather than converted, which is enough to prove it
 * reached the projection at all — the real conversion is `page.ts`'s job, not
 * this class's.
 */
const flat = (lon: number, lat: number, elevationM: number): [number, number, number] => [
  lon,
  lat,
  elevationM,
];

const square = (lon = 0, lat = 0, sizeDeg = 0.0002): Ring => [
  [lon, lat],
  [lon + sizeDeg, lat],
  [lon + sizeDeg, lat + sizeDeg],
  [lon, lat + sizeDeg],
  [lon, lat],
];

/** Read the packed shadow array back as vertices. */
const shadowVerts = (data: Float32Array) => {
  const out: Array<{ x: number; y: number; elevM: number; ceiling: number; dark: number }> = [];
  for (let i = 0; i < data.length; i += 6) {
    out.push({ x: data[i], y: data[i + 1], elevM: data[i + 3], ceiling: data[i + 4], dark: data[i + 5] });
  }
  return out;
};

/** Read the packed blocker array back as vertices. */
const blockerVerts = (data: Float32Array) => {
  const out: Array<{ x: number; y: number; elevM: number; height: number }> = [];
  for (let i = 0; i < data.length; i += 5) {
    out.push({ x: data[i], y: data[i + 1], elevM: data[i + 3], height: data[i + 4] });
  }
  return out;
};

describe('ShadowGeometry', () => {
  it('fans a closed ring into triangles, dropping the repeated vertex', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 180, 45)!;
    const ground = shadow.ring.map(() => 0);
    geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0.5);

    // A closed ring of n+1 points is an n-gon, which fans into n-2 triangles.
    const corners = shadow.ring.length - 1;
    assert.equal(shadowVerts(geometry.shadowVertices()).length, (corners - 2) * 3);
  });

  it('carries the ceiling of each vertex through unchanged', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 40, 180, 30)!;
    const ground = shadow.ring.map(() => 0);
    geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0.5);

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

  it('issue #51: adds the caller\'s ground elevation into the ceiling, not just the position', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 40, 180, 30)!;
    const baseElevM = 500;
    const absoluteCeilings = shadow.ceilings.map((c) => baseElevM + c);
    const ground = shadow.ring.map(() => 500);
    geometry.addShadow(shadow.ring, absoluteCeilings, ground, 0.5);

    for (const v of shadowVerts(geometry.shadowVertices())) {
      assert.ok(v.ceiling >= baseElevM - 1e-4, `${v.ceiling} was never re-based onto ${baseElevM}`);
      assert.equal(v.elevM, 500);
    }
  });

  it('carries a different ground elevation for each vertex of the ring', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 40, 180, 30)!;
    const ground = shadow.ring.map((_, i) => i * 10);
    geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0.5);
    const elevations = new Set(shadowVerts(geometry.shadowVertices()).map((v) => v.elevM));
    assert.ok(elevations.size > 1, 'every vertex got the same elevation, but they were given different ones');
  });

  it('gives every vertex of one shadow the same darkness', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 90, 40)!;
    const ground = shadow.ring.map(() => 0);
    geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0.37);
    for (const vertex of shadowVerts(geometry.shadowVertices())) {
      assert.ok(Math.abs(vertex.dark - 0.37) < 1e-6);
    }
  });

  it('draws nothing for a shadow with no darkness left in it', () => {
    const geometry = new ShadowGeometry(flat);
    const shadow = castShadow(square(), 20, 90, 40)!;
    const ground = shadow.ring.map(() => 0);
    geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0);
    assert.equal(geometry.shadowVertices().length, 0);
  });

  it('packs blockers as position, elevation and absolute height, five floats a vertex', () => {
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(square(), 125, 100);
    const data = geometry.blockerVertices();
    // A square hulls to 4 corners, which fan into 2 triangles.
    assert.equal(data.length, 2 * 3 * 5);
    for (const v of blockerVerts(data)) {
      assert.equal(v.elevM, 100);
      assert.equal(v.height, 125);
    }
  });

  it('leaves out a blocker with no absolute height, which can shadow nothing', () => {
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(square(), 0, 100);
    assert.equal(geometry.blockerVertices().length, 0);
  });

  it('positions every corner of one footprint at the same single ground sample', () => {
    // addBlocker's own documented trade: one elevation for the whole
    // footprint rather than one per vertex, since a building is small next
    // to the DEM grid it sits on.
    const geometry = new ShadowGeometry(flat);
    geometry.addBlocker(square(), 40, 17);
    for (const v of blockerVerts(geometry.blockerVertices())) assert.equal(v.elevM, 17);
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
    geometry.addBlocker(ell, 12, 0);
    // The hull of an L is a pentagon: the notch vertex is interior to it.
    assert.equal(geometry.blockerVertices().length / 5, (5 - 2) * 3);
  });

  it('accumulates many casters into one pair of arrays', () => {
    const geometry = new ShadowGeometry(flat);
    for (let i = 0; i < 5; i++) {
      const foot = square(i * 0.001);
      const shadow = castShadow(foot, 20, 180, 45)!;
      const ground = shadow.ring.map(() => 0);
      geometry.addShadow(shadow.ring, shadow.ceilings, ground, 0.5);
      geometry.addBlocker(foot, 20, 0);
    }
    assert.equal(geometry.shadowVertices().length % 6, 0);
    assert.equal(geometry.blockerVertices().length % 5, 0);
    assert.equal(geometry.blockerVertices().length / 5, 5 * 2 * 3);
  });

  describe('addTerrainFacet', () => {
    const facet: TerrainFacet = { a: [0, 0, 100], b: [0.001, 0, 150], c: [0, 0.001, 80] };

    it('packs one triangle, three vertices, into the blocker buffer', () => {
      const geometry = new ShadowGeometry(flat);
      geometry.addTerrainFacet(facet);
      assert.equal(geometry.blockerVertices().length, 3 * 5);
    });

    it('gives each corner its own height as both its elevation and its blocking height', () => {
      const geometry = new ShadowGeometry(flat);
      geometry.addTerrainFacet(facet);
      const verts = blockerVerts(geometry.blockerVertices());
      const heights = verts.map((v) => v.height).sort((a, b) => a - b);
      assert.deepEqual(heights, [80, 100, 150]);
      for (const v of verts) assert.equal(v.elevM, v.height, 'bare terrain: ground and height must agree');
    });

    it('joins the same buffer buildings and the monolith already fill', () => {
      const geometry = new ShadowGeometry(flat);
      geometry.addBlocker(square(), 20, 0);
      geometry.addTerrainFacet(facet);
      assert.equal(geometry.blockerVertices().length / 5, 2 * 3 + 3);
    });
  });
});
