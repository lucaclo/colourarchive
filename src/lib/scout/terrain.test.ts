import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_HORIZON_RADIUS_M,
  EARTH_CIRCUMFERENCE_M,
  TILE_SIZE,
  chooseZoom,
  fitsZoom,
  tileCountAt,
  decodeTerrarium,
  decodeTerrariumTile,
  elevationAt,
  horizonReachM,
  latToTileY,
  loadHeightField,
  lonToTileX,
  maskToRGBA,
  metresPerSample,
  sampleAt,
  terrainFacets,
  terrainHorizon,
  terrainShadowAt,
  terrainShadowMask,
  tileXToLon,
  tileYToLat,
  tilesFor,
  type Bounds,
  type HeightField,
} from './terrain.ts';

/* ── A landscape built to order ────────────────────────────────────────────── */

const ZOOM = 10;
/** One tile, just north of the equator, where a sample is 152.9 m of ground. */
const ONE_TILE: Bounds = { west: 0.01, east: 0.2, south: 0.02, north: 0.04 };
const MIN_X = Math.floor(lonToTileX(ONE_TILE.west, ZOOM));
const MIN_Y = Math.floor(latToTileY(ONE_TILE.north, ZOOM));

/**
 * A field whose heights come from a function of grid position, so a test can
 * put a ridge exactly where it wants one and then assert about its shadow.
 */
function landscape(
  shape: (col: number, row: number) => number,
  bounds: Bounds = ONE_TILE,
  missing: Array<[number, number]> = [],
): Promise<HeightField> {
  const minX = Math.floor(lonToTileX(bounds.west, ZOOM));
  const minY = Math.floor(latToTileY(bounds.north, ZOOM));
  return loadHeightField(
    bounds,
    async ({ x, y }) => {
      if (missing.some(([mx, my]) => mx === x && my === y)) return null;
      const tile = new Float32Array(TILE_SIZE * TILE_SIZE);
      for (let ty = 0; ty < TILE_SIZE; ty++) {
        for (let tx = 0; tx < TILE_SIZE; tx++) {
          tile[ty * TILE_SIZE + tx] = shape(
            (x - minX) * TILE_SIZE + tx,
            (y - minY) * TILE_SIZE + ty,
          );
        }
      }
      return tile;
    },
    { zoom: ZOOM },
  );
}

const flat = () => 0;
/** A north–south wall `width` cells wide, `height` metres tall, at column `at`. */
const wall = (at: number, height: number, width = 11) => (col: number) =>
  col >= at && col < at + width ? height : 0;

const SAMPLE_M = metresPerSample(0.03, ZOOM, TILE_SIZE);

/* ── Encoding ──────────────────────────────────────────────────────────────── */

describe('decodeTerrarium', () => {
  it('puts sea level at the offset the format defines', () => {
    assert.equal(decodeTerrarium(128, 0, 0), 0);
  });

  it('reads the whole range, in both directions', () => {
    assert.equal(decodeTerrarium(0, 0, 0), -32768);
    assert.equal(decodeTerrarium(128, 100, 0), 100);
    assert.equal(decodeTerrarium(127, 156, 0), -100);
  });

  it('carries the fractional metre in the blue channel', () => {
    assert.equal(decodeTerrarium(128, 0, 128), 0.5);
    assert.equal(decodeTerrarium(128, 8, 64), 8.25);
  });

  it('reads a whole tile, and refuses one of the wrong size', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      rgba[i * 4] = 128;
      rgba[i * 4 + 1] = i;
    }
    const heights = decodeTerrariumTile(rgba, 4);
    assert.equal(heights.length, 16);
    assert.equal(heights[7], 7);
    assert.throws(() => decodeTerrariumTile(rgba, 8), RangeError);
  });
});

/* ── Mercator ──────────────────────────────────────────────────────────────── */

describe('web mercator', () => {
  it('spans the world at zoom zero', () => {
    assert.equal(lonToTileX(-180, 0), 0);
    assert.equal(lonToTileX(0, 0), 0.5);
    assert.equal(lonToTileX(180, 0), 1);
    assert.ok(Math.abs(latToTileY(0, 0) - 0.5) < 1e-12);
  });

  it('round-trips a coordinate through tile space', () => {
    for (const lon of [-179, -30, 0, 12.4, 139.7]) {
      assert.ok(Math.abs(tileXToLon(lonToTileX(lon, 12), 12) - lon) < 1e-9, `${lon}`);
    }
    for (const lat of [-70, -12, 0, 35.66, 69.6]) {
      assert.ok(Math.abs(tileYToLat(latToTileY(lat, 12), 12) - lat) < 1e-9, `${lat}`);
    }
  });

  it('clamps latitudes mercator cannot draw', () => {
    assert.ok(Number.isFinite(latToTileY(90, 8)));
    assert.ok(Number.isFinite(latToTileY(-90, 8)));
  });

  it('shrinks the ground a sample covers with cos(latitude)', () => {
    const equator = metresPerSample(0, 0, TILE_SIZE);
    assert.ok(Math.abs(equator - EARTH_CIRCUMFERENCE_M / 256) < 1e-6);
    // Half the ground per pixel at 60°, which is where cos is exactly a half.
    assert.ok(Math.abs(metresPerSample(60, 0, TILE_SIZE) / equator - 0.5) < 1e-6);
  });

  it('halves the ground per sample with every zoom level', () => {
    assert.ok(Math.abs(metresPerSample(0, 11, TILE_SIZE) * 2 - metresPerSample(0, 10, TILE_SIZE)) < 1e-6);
  });
});

describe('chooseZoom', () => {
  it('drops the zoom until the area fits the tile budget', () => {
    const street: Bounds = { west: -0.13, south: 51.5, east: -0.12, north: 51.51 };
    const region: Bounds = { west: -1.5, south: 50.8, east: 0.6, north: 52.2 };
    const fine = chooseZoom(street);
    const coarse = chooseZoom(region);
    assert.ok(fine > coarse, `${fine} vs ${coarse}`);
    assert.ok(tilesFor(street, fine).length <= 16);
    assert.ok(tilesFor(region, coarse).length <= 16);
  });

  it('stays inside the zoom range it is given', () => {
    const world: Bounds = { west: -180, south: -80, east: 180, north: 80 };
    const zoom = chooseZoom(world, 16, 7, 13);
    assert.ok(zoom >= 7 && zoom <= 13, `${zoom}`);
  });
});

describe('tilesFor', () => {
  it('covers every tile the box touches', () => {
    const tiles = tilesFor(ONE_TILE, ZOOM);
    assert.equal(tiles.length, 1);
    assert.deepEqual(tiles[0], { z: ZOOM, x: MIN_X, y: MIN_Y });
  });

  it('wraps columns across the antimeridian rather than asking for tile −1', () => {
    const straddling: Bounds = { west: 179.5, south: -0.1, east: 180.5, north: 0.1 };
    for (const tile of tilesFor(straddling, 8)) {
      assert.ok(tile.x >= 0 && tile.x < 2 ** 8, `x ${tile.x}`);
      assert.ok(tile.y >= 0 && tile.y < 2 ** 8, `y ${tile.y}`);
    }
  });
});

/* ── Stitching ─────────────────────────────────────────────────────────────── */

describe('fitsZoom', () => {
  const WORLD: Bounds = { west: -180, south: -85, east: 180, north: 85 };
  const STREET: Bounds = { west: -3.196, south: 55.948, east: -3.18, north: 55.958 };

  it('says so when it found a zoom inside the budget', () => {
    const choice = fitsZoom(STREET, 16);
    assert.equal(choice.fits, true);
    assert.ok(choice.tiles <= 16, `${choice.tiles} tiles`);
    assert.equal(choice.tiles, tileCountAt(STREET, choice.zoom));
  });

  it('says so when nothing fits, instead of returning the floor in silence', () => {
    // The whole bug: chooseZoom returns 7 either way, and the number alone
    // cannot tell "this is right" from "this is 1,500× over budget".
    const choice = fitsZoom(WORLD, 16);
    assert.equal(choice.fits, false);
    assert.equal(choice.zoom, 7);
    assert.ok(choice.tiles > 10_000, `${choice.tiles} tiles at the world view`);
    assert.equal(chooseZoom(WORLD, 16), choice.zoom, 'the old shape still agrees');
  });

  it('measures the floor rather than assuming it', () => {
    // A budget only the floor can meet: one tile fewer and z8, four times the
    // tiles, would have to be rejected. The old loop stopped at min + 1 and so
    // never measured the floor at all — it just returned it.
    const exactlyTheFloor = tileCountAt(WORLD, 7);
    const choice = fitsZoom(WORLD, exactlyTheFloor, 7, 13);
    assert.equal(choice.zoom, 7);
    assert.equal(choice.fits, true, 'the floor was measured, not assumed');
    assert.equal(choice.tiles, exactlyTheFloor);

    // One under, and nothing fits at all.
    assert.equal(fitsZoom(WORLD, exactlyTheFloor - 1, 7, 13).fits, false);
  });

  it('counts without building anything', () => {
    assert.equal(tileCountAt(STREET, 13), tilesFor(STREET, 13).length);
    assert.equal(tileCountAt(STREET, 9), tilesFor(STREET, 9).length);
  });
});

describe('loadHeightField', () => {
  it('lays the tiles out in the right places', async () => {
    const field = await landscape((col, row) => col * 1000 + row);
    assert.equal(field.width, TILE_SIZE);
    assert.equal(field.height, TILE_SIZE);
    assert.equal(field.heights[0], 0);
    assert.equal(field.heights[5 * TILE_SIZE + 7], 7005);
    assert.equal(field.tilesRequested, 1);
    assert.equal(field.tilesLoaded, 1);
  });

  it('never has more than eight tiles in flight at once', async () => {
    // The whole map used to go out in one Promise.all. At the world view that
    // was a request for 24,450 elevation tiles; AWS answered 503 and every
    // other request on the page queued behind them.
    const wide: Bounds = { west: 0.01, south: -0.9, east: 1.6, north: 0.9 };
    let inFlight = 0;
    let peak = 0;
    const field = await loadHeightField(wide, async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return new Float32Array(TILE_SIZE * TILE_SIZE);
    });
    assert.ok(field.tilesRequested > 8, `only ${field.tilesRequested} tiles — widen the box`);
    assert.equal(field.tilesLoaded, field.tilesRequested, 'every tile still arrives');
    assert.ok(peak <= 8, `${peak} tiles were in flight at once`);
  });

  it('stitches a multi-tile field into one continuous grid', async () => {
    const twoByTwo: Bounds = { west: 0.01, south: -0.2, east: 0.5, north: 0.2 };
    const field = await landscape((col, row) => col * 1000 + row, twoByTwo);
    assert.equal(field.width, TILE_SIZE * 2);
    assert.equal(field.height, TILE_SIZE * 2);
    // A value from the far tile has to land at the far corner, not back at zero.
    assert.equal(field.heights[(TILE_SIZE + 3) * field.width + (TILE_SIZE + 4)], (TILE_SIZE + 4) * 1000 + TILE_SIZE + 3);
    assert.equal(field.tilesLoaded, 4);
  });

  it('leaves a missing tile at sea level and counts it', async () => {
    const twoByTwo: Bounds = { west: 0.01, south: -0.2, east: 0.5, north: 0.2 };
    const minX = Math.floor(lonToTileX(twoByTwo.west, ZOOM));
    const minY = Math.floor(latToTileY(twoByTwo.north, ZOOM));
    const field = await landscape(() => 500, twoByTwo, [[minX + 1, minY + 1]]);
    assert.equal(field.tilesRequested, 4);
    assert.equal(field.tilesLoaded, 3);
    assert.equal(field.heights[(TILE_SIZE + 10) * field.width + TILE_SIZE + 10], 0);
    assert.equal(field.heights[10 * field.width + 10], 500);
  });

  it('subsamples without moving the ground it covers', async () => {
    const full = await landscape((col) => col);
    const half = await loadHeightField(
      ONE_TILE,
      async () => {
        const tile = new Float32Array(TILE_SIZE * TILE_SIZE);
        for (let ty = 0; ty < TILE_SIZE; ty++) {
          for (let tx = 0; tx < TILE_SIZE; tx++) tile[ty * TILE_SIZE + tx] = tx;
        }
        return tile;
      },
      { zoom: ZOOM, downsample: 2 },
    );
    assert.equal(half.width, TILE_SIZE / 2);
    assert.deepEqual(half.bounds, full.bounds);
    // Every other sample, and a sample twice as wide on the ground.
    assert.equal(half.heights[10], 20);
    assert.ok(Math.abs(half.scaleM[0] / full.scaleM[0] - 2) < 1e-6);
  });

  it('describes the exact mercator rectangle it covers', async () => {
    const field = await landscape(flat);
    assert.ok(Math.abs(field.bounds.west - tileXToLon(MIN_X, ZOOM)) < 1e-12);
    assert.ok(Math.abs(field.bounds.east - tileXToLon(MIN_X + 1, ZOOM)) < 1e-12);
    assert.ok(Math.abs(field.bounds.north - tileYToLat(MIN_Y, ZOOM)) < 1e-12);
    assert.ok(Math.abs(field.bounds.south - tileYToLat(MIN_Y + 1, ZOOM)) < 1e-12);
  });
});

describe('sampleAt and elevationAt', () => {
  it('finds the cell a coordinate falls in', async () => {
    const field = await landscape(flat);
    const lon = tileXToLon(MIN_X + (100 + 0.5) / TILE_SIZE, ZOOM);
    const lat = tileYToLat(MIN_Y + (50 + 0.5) / TILE_SIZE, ZOOM);
    const { col, row } = sampleAt(field, lon, lat);
    assert.ok(Math.abs(col - 100) < 1e-6, `col ${col}`);
    assert.ok(Math.abs(row - 50) < 1e-6, `row ${row}`);
  });

  it('interpolates between samples', async () => {
    const field = await landscape((col) => col * 10);
    const lon = tileXToLon(MIN_X + 100 / TILE_SIZE, ZOOM); // exactly on sample 99.5
    const lat = tileYToLat(MIN_Y + 0.5 / TILE_SIZE, ZOOM);
    const height = elevationAt(field, lon, lat);
    assert.ok(height !== null && Math.abs(height - 995) < 0.001, `${height}`);
  });

  it('says nothing rather than guessing outside the field', async () => {
    const field = await landscape(flat);
    assert.equal(elevationAt(field, 179, 0.03), null);
    assert.equal(elevationAt(field, 0.03, 60), null);
  });
});

/* ── Shadows ───────────────────────────────────────────────────────────────── */

describe('terrainShadowMask', () => {
  it('leaves flat ground entirely lit', async () => {
    const field = await landscape(flat);
    const mask = terrainShadowMask(field, 135, 30);
    assert.equal(mask.shadedCells, 0);
    assert.equal(mask.litCells, mask.width * mask.height);
    assert.equal(mask.wholeFieldDark, false);
  });

  it('darkens everything when the sun is down, and says so', async () => {
    const field = await landscape(flat);
    const mask = terrainShadowMask(field, 270, -3);
    assert.ok(mask.wholeFieldDark);
    assert.equal(mask.litCells, 0);
  });

  it('throws a ridge’s shadow the right way and the right distance', async () => {
    // A 1000 m wall at column 200, with the sun due east at 10°: cot(10°) is
    // 5.67, so the shadow should run about 5.7 km — 37 samples — to the west of
    // it, and nothing at all to the east.
    const field = await landscape(wall(200, 1000));
    const mask = terrainShadowMask(field, 90, 10);
    const at = (col: number) => mask.shadowed[128 * mask.width + col];

    assert.equal(at(199), 1, 'the cell at the foot of the wall is in its shadow');
    assert.equal(at(180), 1, 'three kilometres west is still shaded');
    assert.equal(at(150), 0, 'seven and a half kilometres west is clear');
    assert.equal(at(215), 0, 'the sunward side is lit');

    // Where the shadow ends, to within a couple of samples of cot(10°) × 1000 m.
    let edge = 199;
    while (edge > 0 && at(edge) === 1) edge--;
    const reachM = (199 - edge) * SAMPLE_M;
    const expected = 1000 / Math.tan(10 * (Math.PI / 180));
    assert.ok(Math.abs(reachM - expected) < 3 * SAMPLE_M, `reached ${Math.round(reachM)}m, expected ${Math.round(expected)}m`);
  });

  it('swings the shadow round with the sun', async () => {
    const field = await landscape(wall(200, 1000));
    const fromWest = terrainShadowMask(field, 270, 10);
    const row = 128 * fromWest.width;
    assert.equal(fromWest.shadowed[row + 215], 1, 'sun in the west shades the east side');
    assert.equal(fromWest.shadowed[row + 180], 0, 'and leaves the west side lit');
  });

  it('shortens the shadow as the sun climbs', async () => {
    const field = await landscape(wall(200, 1000));
    const count = (altitude: number) => terrainShadowMask(field, 90, altitude).shadedCells;
    const low = count(5);
    const mid = count(20);
    const high = count(60);
    assert.ok(low > mid && mid > high, `${low} / ${mid} / ${high}`);
  });

  it('does not let a hollow shade itself', async () => {
    const field = await landscape((col) => (col >= 120 && col < 140 ? -50 : 0));
    const mask = terrainShadowMask(field, 90, 30);
    // The floor of a shallow dip is below its own rim, so the rim does cast into
    // it — but only a little way, and the ground outside is untouched.
    assert.equal(mask.shadowed[128 * mask.width + 100], 0);
    assert.equal(mask.shadowed[128 * mask.width + 160], 0);
  });

  it('lets the earth’s curvature hide a distant low ridge', async () => {
    // Ten kilometres out the ground has curved about 6.6 m below the sightline,
    // so a 5 m ridge there is invisible and a 20 m one is not. Without the
    // curvature term both would block, and every distant flat coast would cast.
    const near = await landscape(wall(165, 5, 8));
    const far = await landscape(wall(165, 20, 8));
    const lowRidge = terrainShadowMask(near, 90, 0.02);
    const highRidge = terrainShadowMask(far, 90, 0.02);
    assert.equal(lowRidge.shadowed[128 * lowRidge.width + 100], 0, 'the 5 m ridge is over the horizon');
    assert.equal(highRidge.shadowed[128 * highRidge.width + 100], 1, 'the 20 m one still blocks');
  });
});

describe('terrainShadowMask over a narrow ridge', () => {
  /**
   * The regression the sweep exists for.
   *
   * The march this replaced grew its step by 3.5% a time, so by a few kilometres
   * out it was sampling every 200 m and a one-cell crest fell between two
   * samples. Measured on this exact shape before the rewrite: a single-cell
   * ridge shaded 26% of the ground behind it, two cells 48%, six cells 84%. The
   * ray went through the mountain, and which cells it went through changed with
   * the sun's azimuth, so the holes crawled about as the slider moved.
   *
   * A crest is a crest at any distance. Every width must shade all of it.
   */
  for (const cells of [1, 2, 6, 20]) {
    it(`shades the whole throw of a ${cells}-cell ridge`, async () => {
      const field = await landscape(wall(200, 1000, cells));
      const mask = terrainShadowMask(field, 90, 10);
      const reach = Math.floor(1000 / Math.tan(10 * (Math.PI / 180)) / SAMPLE_M);

      let shaded = 0;
      for (let col = 200 - reach; col < 200; col++) {
        if (mask.shadowed[128 * mask.width + col]) shaded++;
      }
      // Every cell from the foot of the wall out to a sample short of the tip.
      assert.ok(shaded >= reach - 1, `${shaded} of ${reach} cells shaded`);
    });
  }

  it('holds at every azimuth, so the holes cannot crawl with the sun', async () => {
    // The visible symptom was motion: a shadow that flickered as the time
    // slider moved. That is this test — the same ridge, swept round, must give
    // an answer that changes smoothly rather than one that is riddled at some
    // bearings and solid at others.
    const field = await landscape(wall(200, 1000, 1));
    for (let azimuth = 60; azimuth <= 120; azimuth += 5) {
      const mask = terrainShadowMask(field, azimuth, 10);
      // Immediately downwind of the wall, on the row through the middle.
      assert.equal(
        mask.shadowed[128 * mask.width + 199],
        1,
        `azimuth ${azimuth} let the light through the wall`,
      );
    }
  });

  it('costs no more to look across the whole field than a short way', async () => {
    // The march was bounded by a distance cap because it re-marched from every
    // cell. The sweep touches each cell once, so the cap is gone — and this is
    // the claim that made removing it safe.
    const field = await landscape((col, row) => ((col * 7 + row * 13) % 97) * 8);
    const started = performance.now();
    terrainShadowMask(field, 115, 6);
    const elapsed = performance.now() - started;
    const cells = field.width * field.height;
    assert.ok(elapsed < 250, `${cells} cells took ${elapsed.toFixed(0)}ms`);
  });
});

describe('terrainShadowMask at stride', () => {
  it('agrees closely with the exact mask, at a quarter of the work', async () => {
    const field = await landscape(wall(200, 1000));
    const exact = terrainShadowMask(field, 90, 10);
    const coarse = terrainShadowMask(field, 90, 10, { stride: 2 });

    let differing = 0;
    for (let i = 0; i < exact.shadowed.length; i++) {
      if (exact.shadowed[i] !== coarse.shadowed[i]) differing++;
    }
    const fraction = differing / exact.shadowed.length;
    // The disagreement is confined to the shadow's edge, which is where a
    // stride-2 answer is a sample or two out. Anything more would mean the
    // preview is telling a different story from the exact pass.
    assert.ok(fraction < 0.02, `${(fraction * 100).toFixed(2)}% of cells differ`);
  });

  it('puts the shadow in the same place, not merely the same amount', async () => {
    const field = await landscape(wall(200, 1000));
    const coarse = terrainShadowMask(field, 90, 10, { stride: 2 });
    const row = 128 * coarse.width;
    assert.equal(coarse.shadowed[row + 199], 1);
    assert.equal(coarse.shadowed[row + 180], 1);
    assert.equal(coarse.shadowed[row + 150], 0);
    assert.equal(coarse.shadowed[row + 215], 0);
  });

  it('still fills every cell it claims, with no gaps in the block', async () => {
    const field = await landscape(wall(200, 1000));
    const coarse = terrainShadowMask(field, 90, 10, { stride: 3 });
    assert.equal(coarse.shadedCells + coarse.litCells, coarse.width * coarse.height);
    // A striped result would show as alternating rows inside the shadow.
    for (let row = 100; row < 140; row++) {
      assert.equal(coarse.shadowed[row * coarse.width + 190], 1, `row ${row}`);
    }
  });

  it('treats a nonsense stride as no stride', async () => {
    const field = await landscape(wall(200, 1000));
    const exact = terrainShadowMask(field, 90, 10);
    for (const stride of [0, -3, 0.4]) {
      const same = terrainShadowMask(field, 90, 10, { stride });
      assert.equal(same.shadedCells, exact.shadedCells, `stride ${stride}`);
    }
  });
});

describe('terrainShadowAt', () => {
  it('agrees with the mask it is the single-point version of', async () => {
    const field = await landscape(wall(200, 1000));
    const mask = terrainShadowMask(field, 90, 10);
    for (const col of [140, 170, 185, 199, 210, 230]) {
      const lon = tileXToLon(MIN_X + (col + 0.5) / TILE_SIZE, ZOOM);
      const lat = tileYToLat(MIN_Y + 128.5 / TILE_SIZE, ZOOM);
      const point = terrainShadowAt(field, lon, lat, 90, 10);
      assert.equal(point, mask.shadowed[128 * mask.width + col] === 1, `column ${col}`);
    }
  });

  it('is dark when the sun is down and unknown off the field', async () => {
    const field = await landscape(flat);
    const lon = tileXToLon(MIN_X + 0.5, ZOOM);
    const lat = tileYToLat(MIN_Y + 0.5, ZOOM);
    assert.equal(terrainShadowAt(field, lon, lat, 90, -1), true);
    assert.equal(terrainShadowAt(field, 179, 0, 90, 30), null);
  });
});

describe('terrainHorizon', () => {
  it('measures the angle a ridge subtends, on the right bearing', async () => {
    const field = await landscape(wall(200, 1000));
    const lon = tileXToLon(MIN_X + 100.5 / TILE_SIZE, ZOOM);
    const lat = tileYToLat(MIN_Y + 128.5 / TILE_SIZE, ZOOM);
    const horizon = terrainHorizon(field, lon, lat, { stepDeg: 1 });

    const east = horizon.altitudes[90];
    const distance = 100 * SAMPLE_M;
    const expected = Math.atan(1000 / distance) * (180 / Math.PI);
    assert.ok(Math.abs(east - expected) < 0.3, `east ${east}°, expected about ${expected.toFixed(2)}°`);
    assert.equal(horizon.altitudes[270], 0, 'nothing to the west');
    assert.ok(Math.abs(horizon.peakBearing - 90) < 20, `peak on ${horizon.peakBearing}°`);
    assert.equal(horizon.elevationM, 0);
  });

  it('reports a flat world as having no horizon at all', async () => {
    const field = await landscape(flat);
    const lon = tileXToLon(MIN_X + 128.5 / TILE_SIZE, ZOOM);
    const lat = tileYToLat(MIN_Y + 128.5 / TILE_SIZE, ZOOM);
    const horizon = terrainHorizon(field, lon, lat, { stepDeg: 2 });
    assert.equal(horizon.peakAltitude, 0);
    assert.ok(horizon.altitudes.every((a) => a === 0));
  });

  it('says it has no viewpoint rather than inventing one', async () => {
    const field = await landscape(flat);
    const horizon = terrainHorizon(field, 179, 0, { stepDeg: 10 });
    assert.equal(horizon.elevationM, null);
    assert.equal(horizon.peakAltitude, 0);
  });

  it('defaults to a radius wide enough for issue #52 — a real ridge, not just a hill', () => {
    // horizonReachM(1500) itself is the honest justification for the number;
    // this just holds the default to it, so the two cannot quietly drift apart.
    assert.ok(DEFAULT_HORIZON_RADIUS_M >= horizonReachM(1500));
  });
});

describe('horizonReachM', () => {
  it('agrees with terrainHorizon\'s own ray march about where a peak crosses the horizon', async () => {
    // The independent cross-check: build a wall at exactly the distance
    // `horizonReachM` predicts for its height, and ask the ray march — which
    // knows nothing about this function — what apparent altitude it measures
    // there. If the two disagree, one of them is wrong.
    const height = 40;
    const at = Math.round(horizonReachM(height) / SAMPLE_M);
    const field = await landscape(wall(at, height, 3));
    const lon = tileXToLon(MIN_X + 0.5 / TILE_SIZE, ZOOM);
    const lat = tileYToLat(MIN_Y + 128.5 / TILE_SIZE, ZOOM);
    const horizon = terrainHorizon(field, lon, lat, { stepDeg: 1 });
    assert.ok(
      Math.abs(horizon.altitudes[90]) < 0.3,
      `expected near 0° at the computed crossing, got ${horizon.altitudes[90]}°`,
    );
  });

  it('grows with the square root of the height, not with the height itself', () => {
    // sqrt(2RH): quadrupling the height only doubles the distance.
    const base = horizonReachM(100);
    const quadrupled = horizonReachM(400);
    assert.ok(Math.abs(quadrupled / base - 2) < 1e-9);
  });

  it('is zero for a peak at or below the observer\'s own height', () => {
    assert.equal(horizonReachM(0), 0);
    assert.equal(horizonReachM(-50), 0);
  });
});

describe('terrainFacets', () => {
  it('covers the field in two triangles a cell, at the requested stride', async () => {
    const field = await landscape(flat);
    const stride = 8;
    const facets = terrainFacets(field, stride);
    const cellsAcross = Math.floor((field.width - 1) / stride);
    const cellsDown = Math.floor((field.height - 1) / stride);
    assert.equal(facets.length, cellsAcross * cellsDown * 2);
  });

  it('carries each corner\'s own height, not the cell\'s average', async () => {
    const field = await landscape(wall(64, 500, 8));
    const facets = terrainFacets(field, 8);
    const onTheWall = facets.filter((f) => [f.a[2], f.b[2], f.c[2]].some((h) => h === 500));
    const offIt = facets.filter((f) => [f.a[2], f.b[2], f.c[2]].every((h) => h === 0));
    assert.ok(onTheWall.length > 0, 'some facet should touch the wall');
    assert.ok(offIt.length > 0, 'some facet should miss it entirely');
  });

  it('places each corner where sampleAt says that cell actually is', async () => {
    const field = await landscape(wall(100, 300, 1));
    const facets = terrainFacets(field, 16);
    for (const facet of facets) {
      for (const [lon, lat, heightM] of [facet.a, facet.b, facet.c]) {
        const { col, row } = sampleAt(field, lon, lat);
        const nearestCol = Math.round(col);
        const nearestRow = Math.round(row);
        assert.equal(heightM, field.heights[nearestRow * field.width + nearestCol]);
      }
    }
  });

  it('is empty rather than broken for a field too small to hold a stride', async () => {
    const field = await landscape(flat, { west: 0.01, east: 0.011, south: 0.02, north: 0.021 });
    assert.deepEqual(terrainFacets(field, 220_000), []);
  });

  it('coarsens smoothly: a wider stride never grows the triangle count', async () => {
    const field = await landscape(flat);
    let previous = terrainFacets(field, 2).length;
    for (const stride of [4, 8, 16, 32]) {
      const count = terrainFacets(field, stride).length;
      assert.ok(count <= previous, `stride ${stride} gave ${count}, more than the previous ${previous}`);
      previous = count;
    }
  });
});

describe('maskToRGBA', () => {
  it('paints shadow opaque and sun clear', async () => {
    const field = await landscape(wall(200, 1000));
    const mask = terrainShadowMask(field, 90, 10);
    const rgba = maskToRGBA(mask, [20, 26, 44], 0.5, 0);
    const alphaAt = (col: number, row: number) => rgba[(row * mask.width + col) * 4 + 3];
    assert.equal(alphaAt(190, 128), 128);
    assert.equal(alphaAt(240, 128), 0);
    assert.equal(rgba[(128 * mask.width + 190) * 4], 20);
  });

  it('softens the edge without moving it', async () => {
    const field = await landscape(wall(200, 1000));
    const mask = terrainShadowMask(field, 90, 10);
    const soft = maskToRGBA(mask, [0, 0, 0], 1, 2);
    const alphaAt = (col: number) => soft[(128 * mask.width + col) * 4 + 3];
    // Deep inside and far outside stay absolute; the boundary gets a ramp.
    assert.equal(alphaAt(190), 255);
    assert.equal(alphaAt(240), 0);
    let intermediate = 0;
    for (let col = 150; col < 175; col++) {
      const a = alphaAt(col);
      if (a > 0 && a < 255) intermediate++;
    }
    assert.ok(intermediate >= 2, `only ${intermediate} softened samples`);
  });
});
