/**
 * Tests for the line of sight.
 *
 * Built on landscapes made to order, same as the terrain tests, so a ridge can
 * be put at a known height and distance and the arithmetic checked against what
 * similar triangles say it must be. The two cross-checks that matter:
 *
 *   - A ridge exactly on the straight line between two equal-height ends must
 *     block by its own height above that line, and the rise it demands must be
 *     the deficit divided by the fraction of the way it is *not* along — apply
 *     the rise and the clearance must come out at zero.
 *   - Curvature must appear where the standard bulge formula puts it, biggest in
 *     the middle and zero at both ends, and a long flat sightline that clears
 *     without it must fail with it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EYE_M,
  lineOfSight,
  profileGeometry,
  type ProfileOptions,
} from './profile.ts';
import { destination, distance, intermediatePoint, type LatLon } from './geo.ts';
import {
  TILE_SIZE,
  latToTileY,
  loadHeightField,
  lonToTileX,
  metresPerSample,
  type Bounds,
  type HeightField,
} from './terrain.ts';

const ZOOM = 10;
/** Just north of the equator, where one grid sample is about 152.9 m of ground. */
const ONE_TILE: Bounds = { west: 0.01, east: 0.2, south: 0.02, north: 0.04 };
const SAMPLE_M = metresPerSample(0.03, ZOOM, TILE_SIZE);

function landscape(
  shape: (col: number, row: number) => number,
  bounds: Bounds = ONE_TILE,
): Promise<HeightField> {
  const minX = Math.floor(lonToTileX(bounds.west, ZOOM));
  const minY = Math.floor(latToTileY(bounds.north, ZOOM));
  return loadHeightField(
    bounds,
    async ({ x, y }) => {
      const tile = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let ty = 0; ty < TILE_SIZE; ty++) {
        for (let tx = 0; tx < TILE_SIZE; tx++) {
          tile[ty * TILE_SIZE + tx] = shape((x - minX) * TILE_SIZE + tx, (y - minY) * TILE_SIZE + ty);
        }
      }
      return tile;
    },
    { zoom: ZOOM },
  );
}

const flat = () => 0;
/** A north–south wall `width` cells wide and `height` metres tall at column `at`. */
const wall = (at: number, height: number, width = 9) => (col: number) =>
  col >= at && col < at + width ? height : 0;

/** A point on the field's middle row, `col` grid columns from its west edge. */
function atColumn(field: HeightField, col: number): LatLon {
  const west = lonToTileX(field.bounds.west, ZOOM);
  const samplesPerTile = field.width / (lonToTileX(field.bounds.east, ZOOM) - west);
  const lon = ((west + (col + 0.5) / samplesPerTile) / 2 ** ZOOM) * 360 - 180;
  return { lat: 0.03, lon };
}

const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} expected ${a} ≈ ${b} (±${tol})`);

const EYE: ProfileOptions = { eyeM: 0, targetM: 0, samples: 401 };

/* ── The interpolation it stands on ────────────────────────────────────────── */

describe('intermediatePoint', () => {
  const EDINBURGH: LatLon = { lat: 55.9533, lon: -3.1883 };
  const TROMSO: LatLon = { lat: 69.6496, lon: 18.956 };

  it('returns the ends at 0 and 1', () => {
    close(distance(intermediatePoint(EDINBURGH, TROMSO, 0), EDINBURGH), 0, 1e-6);
    close(distance(intermediatePoint(EDINBURGH, TROMSO, 1), TROMSO), 0, 1e-6);
  });

  it('splits the great circle in proportion, not the coordinates', () => {
    const total = distance(EDINBURGH, TROMSO);
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const point = intermediatePoint(EDINBURGH, TROMSO, f);
      close(distance(EDINBURGH, point), f * total, 1, `at ${f}`);
      close(distance(point, TROMSO), (1 - f) * total, 1, `at ${f}`);
    }
  });

  it('leaves the great circle where a bearing walk would drift off it', () => {
    // Over this distance the rhumb-line walk and the great circle separate by
    // kilometres — enough to sample an entirely different ridge.
    const half = intermediatePoint(EDINBURGH, TROMSO, 0.5);
    const walked = destination(EDINBURGH, 33.6, distance(EDINBURGH, TROMSO) / 2);
    assert.ok(distance(half, walked) > 1000, 'the two paths did not differ');
  });

  it('is stable for a zero-length pair and refuses the antipodes', () => {
    assert.deepEqual(intermediatePoint(EDINBURGH, EDINBURGH, 0.5), {
      lat: EDINBURGH.lat,
      lon: EDINBURGH.lon,
    });
    assert.throws(
      () => intermediatePoint({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }, 0.5),
      RangeError,
    );
  });
});

/* ── A clear view ──────────────────────────────────────────────────────────── */

describe('lineOfSight — flat ground', () => {
  it('sees straight across, with the eye height as the clearance', async () => {
    // 4.6 km, which is inside the range a 2 m eye can see across level ground:
    // the bulge at that distance is 1.4 m. Any further and the earth alone
    // blocks it, which the next test but one is about.
    const field = await landscape(flat);
    const from = atColumn(field, 20);
    const to = atColumn(field, 50);
    const sight = lineOfSight(field, from, to, { eyeM: 2, targetM: 0, samples: 201 });

    assert.equal(sight.clear, true);
    assert.equal(sight.missingSamples, 0);
    assert.equal(sight.requiredRiseM, 0);
    assert.match(sight.note, /Clear line of sight/);
    // The line falls from 2 m to 0 m, so the tightest point is at the far end.
    assert.ok(sight.minClearanceM! > 0 && sight.minClearanceM! < 0.1);
  });

  it('measures the distance and bearing it actually walked', async () => {
    const field = await landscape(flat);
    const from = atColumn(field, 20);
    const to = atColumn(field, 200);
    const sight = lineOfSight(field, from, to, EYE);
    close(sight.distanceM, distance(from, to), 0.5);
    close(sight.bearing, 90, 0.5, 'due east along a row');
    close(sight.samples[sight.samples.length - 1].distanceM, sight.distanceM, 1e-6);
  });

  it('puts the curvature bulge where the standard formula does', async () => {
    const field = await landscape(flat);
    const sight = lineOfSight(field, atColumn(field, 5), atColumn(field, 250), EYE);
    const D = sight.distanceM;
    const R = (7 / 6) * 6_371_008.8;
    assert.equal(sight.samples[0].bulgeM, 0);
    close(sight.samples[sight.samples.length - 1].bulgeM, 0, 1e-9);
    for (const s of sight.samples) {
      close(s.bulgeM, (s.distanceM * (D - s.distanceM)) / (2 * R), 1e-9, `at ${s.distanceM}`);
    }
    // Biggest in the middle, and real: tens of kilometres is tens of metres.
    const middle = sight.samples[Math.floor(sight.samples.length / 2)];
    close(middle.bulgeM, (D * D) / (8 * R), 0.01);
  });

  it('lets the earth block a long level view that flat geometry would clear', async () => {
    // Both ends at sea level, both eyes on the ground, 37 km apart: the bulge in
    // the middle is about 25 m and there is nothing else in the way.
    const field = await landscape(flat, { west: 0.01, east: 0.5, south: 0.02, north: 0.04 });
    const sight = lineOfSight(field, atColumn(field, 5), atColumn(field, 245), {
      eyeM: 0,
      targetM: 0,
      samples: 401,
    });
    assert.ok(sight.distanceM > 30_000, `only ${Math.round(sight.distanceM)} m apart`);
    assert.equal(sight.clear, false);
    close(sight.minClearanceM!, -(sight.distanceM ** 2) / (8 * ((7 / 6) * 6_371_008.8)), 0.5);
    assert.ok(sight.requiredRiseM! > 20, `rise was ${sight.requiredRiseM}`);
  });
});

/* ── A blocked view ────────────────────────────────────────────────────────── */

describe('lineOfSight — a ridge in the way', () => {
  it('blocks by the ridge height, and says where', async () => {
    const field = await landscape(wall(100, 300));
    const from = atColumn(field, 20);
    const to = atColumn(field, 200);
    const sight = lineOfSight(field, from, to, EYE);

    assert.equal(sight.clear, false);
    // Ends are both at sea level with no eye height, so the line runs along zero
    // and the ridge stands its full 300 m into it — plus the bulge, which lifts
    // the far side of the wall higher than the near side and is why the tightest
    // point is the last column of the wall rather than the first.
    assert.ok(sight.minClearanceM! < -300, `only ${sight.minClearanceM}`);
    close(sight.minClearanceM!, -300, 20);
    assert.ok(
      sight.minClearanceAtM! >= 79 * SAMPLE_M && sight.minClearanceAtM! <= 89 * SAMPLE_M,
      `blocked at ${sight.minClearanceAtM}, outside the wall`,
    );
    assert.match(sight.note, /Blocked/);
    assert.match(sight.note, /higher would clear it/);
  });

  it('demands a rise that exactly clears it, by construction', async () => {
    const field = await landscape(wall(100, 300));
    const from = atColumn(field, 20);
    const to = atColumn(field, 200);
    const blocked = lineOfSight(field, from, to, EYE);
    assert.ok(blocked.requiredRiseM! > 0);

    const raised = lineOfSight(field, from, to, { ...EYE, eyeM: blocked.requiredRiseM! });
    assert.equal(raised.clear, true);
    // And only just — a rise that clears by metres would be the wrong answer.
    assert.ok(raised.minClearanceM! < 1, `cleared by ${raised.minClearanceM}`);
  });

  it('clears the same ridge from high enough ground', async () => {
    // A summit at column 20 falling away to the plain by column 40, then the
    // same 300 m wall. From up there the line passes 190 m over it.
    const hill = (col: number) =>
      col <= 20 ? 900 : col < 40 ? 900 * (1 - (col - 20) / 20) : 0;
    const field = await landscape((col, row) => Math.max(hill(col), wall(100, 300)(col)));
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 200), EYE);
    assert.equal(sight.clear, true);
    assert.equal(sight.requiredRiseM, 0);
  });

  it('picks the worst obstacle when there are two', async () => {
    const field = await landscape((col, row) => wall(60, 120)(col) + wall(140, 400)(col));
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 220), EYE);
    assert.equal(sight.clear, false);
    // The taller, further wall is the one that decides the rise.
    close(sight.minClearanceAtM!, 120 * SAMPLE_M, 6 * SAMPLE_M);
  });

  it('never lets the ends block themselves', async () => {
    // Viewer and target both standing on a plateau: the ground beneath each is
    // level with the eye, and a naive scan would call that a 500 m obstruction.
    // Over 1.5 km the only thing left in the way is 4 cm of curvature.
    const field = await landscape(() => 500);
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 30), {
      eyeM: 0,
      targetM: 0,
      samples: 51,
    });
    assert.ok(sight.minClearanceM! >= -0.05, `got ${sight.minClearanceM}`);
  });

  it('reports the target as a real angle above the horizontal', async () => {
    const field = await landscape((col) => (col >= 190 ? 1000 : 0));
    const from = atColumn(field, 20);
    const to = atColumn(field, 200);
    const sight = lineOfSight(field, from, to, { eyeM: 0, targetM: 0, samples: 201 });
    const expected = Math.atan2(1000 - (sight.distanceM ** 2) / (2 * ((7 / 6) * 6_371_008.8)), sight.distanceM) * (180 / Math.PI);
    close(sight.targetAltitudeDeg!, expected, 0.01);
    assert.ok(sight.targetAltitudeDeg! > 0);
  });
});

/* ── Honesty about missing ground ──────────────────────────────────────────── */

describe('lineOfSight — what it will not answer', () => {
  it('refuses a viewpoint or target off the field', async () => {
    const field = await landscape(flat);
    const off: LatLon = { lat: 40, lon: 40 };
    assert.match(lineOfSight(field, off, atColumn(field, 100)).note, /viewpoint is outside/);
    assert.match(lineOfSight(field, atColumn(field, 100), off).note, /target is outside/);
    assert.equal(lineOfSight(field, off, atColumn(field, 100)).clear, false);
  });

  it('refuses a zero-length sightline instead of dividing by it', async () => {
    const field = await landscape(flat);
    const here = atColumn(field, 100);
    const sight = lineOfSight(field, here, here);
    assert.equal(sight.samples.length, 0);
    assert.match(sight.note, /same point/);
  });

  it('leaves nothing unmeasured on a path that stays on the field', async () => {
    // The missing-sample branch is defensive: with both ends on the field, only
    // a great-circle bulge out of the rectangle can lose an interior sample. On
    // an ordinary path nothing should be missing, and every clearance should be
    // a number rather than a null standing in for one.
    const field = await landscape(flat);
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 200), EYE);
    assert.equal(sight.missingSamples, 0);
    for (const s of sight.samples) {
      assert.notEqual(s.elevationM, null);
      assert.notEqual(s.clearanceM, null);
    }
    assert.ok(!sight.note.includes('outside the loaded elevation'));
  });

  it('defaults the eye to a camera on a tripod, not to the ground', async () => {
    const field = await landscape(flat);
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 100));
    assert.equal(sight.eyeM, DEFAULT_EYE_M);
    assert.ok(DEFAULT_EYE_M > 1);
  });

  it('says plainly that it knows nothing about trees or buildings', async () => {
    const field = await landscape(flat);
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 50));
    assert.equal(sight.clear, true);
    assert.match(sight.note, /trees and buildings are not in this/);
  });
});

/* ── The chart ─────────────────────────────────────────────────────────────── */

describe('profileGeometry', () => {
  it('draws both curves against one shared vertical scale', async () => {
    const field = await landscape(wall(100, 300));
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 200), EYE);
    const geometry = profileGeometry(sight, 400, 120);

    assert.ok(geometry.terrainPath.startsWith('M'));
    assert.ok(geometry.terrainPath.endsWith('Z'), 'ground must close for a fill');
    assert.ok(geometry.sightPath.startsWith('M'));
    assert.ok(geometry.topM > geometry.bottomM);
    // The 300 m ridge has to be inside the box the axis labels describe.
    assert.ok(geometry.topM >= 300, `top was ${geometry.topM}`);
  });

  it('marks the blocking point, and only when there is one', async () => {
    const field = await landscape(wall(100, 300));
    const blocked = lineOfSight(field, atColumn(field, 20), atColumn(field, 200), EYE);
    const clear = lineOfSight(field, atColumn(field, 20), atColumn(field, 50), { ...EYE, eyeM: 2 });
    assert.equal(clear.clear, true);
    assert.notEqual(profileGeometry(blocked, 400, 120).blockPoint, null);
    assert.equal(profileGeometry(clear, 400, 120).blockPoint, null);
  });

  it('keeps every drawn point inside the box', async () => {
    const field = await landscape((col) => Math.sin(col / 9) * 400 + 500);
    const sight = lineOfSight(field, atColumn(field, 10), atColumn(field, 240), EYE);
    const geometry = profileGeometry(sight, 400, 120);
    for (const [, , xs, ys] of geometry.terrainPath.matchAll(/([ML])([\d.-]+) ([\d.-]+)/g)) {
      assert.ok(Number(xs) >= -0.01 && Number(xs) <= 400.01, `x ${xs}`);
      assert.ok(Number(ys) >= -0.01 && Number(ys) <= 120.01, `y ${ys}`);
    }
  });

  it('gives dead-flat ground a box to sit in rather than a zero-height sliver', async () => {
    const field = await landscape(() => 250);
    const sight = lineOfSight(field, atColumn(field, 20), atColumn(field, 60), {
      eyeM: 0,
      targetM: 0,
      samples: 41,
    });
    const geometry = profileGeometry(sight, 400, 120);
    assert.ok(geometry.topM - geometry.bottomM >= 1, 'no vertical range at all');
    assert.ok(Number.isFinite(geometry.topM) && Number.isFinite(geometry.bottomM));
  });

  it('draws nothing rather than something wrong when there is nothing to draw', async () => {
    const field = await landscape(flat);
    const here = atColumn(field, 100);
    const geometry = profileGeometry(lineOfSight(field, here, here), 400, 120);
    assert.equal(geometry.terrainPath, '');
    assert.equal(geometry.sightPath, '');
    assert.equal(geometry.blockPoint, null);
  });
});
