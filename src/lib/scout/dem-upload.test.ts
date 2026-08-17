/**
 * Tests for the GeoTIFF DEM upload — issue #50.
 *
 * Fixtures are real GeoTIFFs, built with `geotiff.js`'s own writer rather
 * than hand-rolled binary or a mock of the reader: what is under test is the
 * parsing and the sampling, and the only way those are checked honestly is
 * against a file the library itself considers valid.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeArrayBuffer } from 'geotiff';

import {
  DemUploadError,
  MAX_UPLOAD_BYTES,
  elevationFromUpload,
  elevationWithOverride,
  parseGeoTiffDem,
  type UploadedDem,
} from './dem-upload.ts';

/** A small georeferenced elevation raster, real enough for geotiff.js to read back. */
function makeGeoTiff(
  width: number,
  height: number,
  heights: number[],
  origin: { west: number; north: number; scaleX: number; scaleY: number },
): ArrayBuffer {
  const data = Float32Array.from(heights);
  return writeArrayBuffer(data, {
    width,
    height,
    ModelPixelScale: [origin.scaleX, origin.scaleY, 0],
    ModelTiepoint: [0, 0, 0, origin.west, origin.north, 0],
    // Without an explicit CRS key the writer silently discards the tie point
    // above and defaults to one that fits the whole globe (geotiffwriter.js)
    // — a real gotcha, worth naming rather than leaving as an unexplained
    // "why is GeographicTypeGeoKey here" line.
    GeographicTypeGeoKey: 4326,
  });
}

// A 4×3 ramp, 10 m a cell, over Edinburgh-ish coordinates.
const RAMP = Array.from({ length: 12 }, (_, i) => i * 10);
const ORIGIN = { west: -3.2, north: 55.96, scaleX: 0.001, scaleY: 0.001 };

describe('parseGeoTiffDem', () => {
  it('reads a real GeoTIFF into the HeightField-like shape terrain.ts expects', async () => {
    const buffer = makeGeoTiff(4, 3, RAMP, ORIGIN);
    const dem = await parseGeoTiffDem(buffer);
    assert.equal(dem.width, 4);
    assert.equal(dem.height, 3);
    assert.deepEqual(Array.from(dem.heights), RAMP);
  });

  it('recovers the bounding box the tie point and pixel scale describe', async () => {
    const buffer = makeGeoTiff(4, 3, RAMP, ORIGIN);
    const dem = await parseGeoTiffDem(buffer);
    assert.ok(Math.abs(dem.bounds.west - ORIGIN.west) < 1e-9);
    assert.ok(Math.abs(dem.bounds.north - ORIGIN.north) < 1e-9);
    assert.ok(Math.abs(dem.bounds.east - (ORIGIN.west + 4 * ORIGIN.scaleX)) < 1e-9);
    assert.ok(Math.abs(dem.bounds.south - (ORIGIN.north - 3 * ORIGIN.scaleY)) < 1e-9);
  });

  it('refuses a file whose coordinates are not longitude and latitude', async () => {
    // A real UTM zone (30N), tie-pointed at an easting/northing in the
    // hundreds of thousands — nowhere near a valid longitude or latitude.
    // ProjectedCSTypeGeoKey has to be set explicitly: without a declared CRS
    // the writer assumes geographic and silently replaces the tie point with
    // one that fits the whole globe (see makeGeoTiff's own note).
    const data = Float32Array.from(RAMP);
    const buffer = writeArrayBuffer(data, {
      width: 4,
      height: 3,
      ModelPixelScale: [10, 10, 0],
      ModelTiepoint: [0, 0, 0, 500_000, 6_200_000, 0],
      ProjectedCSTypeGeoKey: 32630,
    });
    await assert.rejects(() => parseGeoTiffDem(buffer), DemUploadError);
  });

  it('refuses a file larger than the upload cap', async () => {
    const buffer = new ArrayBuffer(MAX_UPLOAD_BYTES + 1);
    await assert.rejects(() => parseGeoTiffDem(buffer), DemUploadError);
  });

  it('refuses something that is not a GeoTIFF at all', async () => {
    const junk = new TextEncoder().encode('not a tiff').buffer;
    await assert.rejects(() => parseGeoTiffDem(junk), DemUploadError);
  });

  it('refuses a raster with too few cells to be a survey', async () => {
    const buffer = makeGeoTiff(1, 1, [10], ORIGIN);
    await assert.rejects(() => parseGeoTiffDem(buffer), DemUploadError);
  });
});

describe('elevationFromUpload', () => {
  const dem: UploadedDem = {
    width: 4,
    height: 3,
    heights: Float32Array.from(RAMP),
    bounds: {
      west: ORIGIN.west,
      north: ORIGIN.north,
      east: ORIGIN.west + 4 * ORIGIN.scaleX,
      south: ORIGIN.north - 3 * ORIGIN.scaleY,
    },
  };

  it('reads a cell centre exactly', () => {
    // Cell (0,0)'s centre is at half a pixel in from the tie point.
    const lon = ORIGIN.west + ORIGIN.scaleX * 0.5;
    const lat = ORIGIN.north - ORIGIN.scaleY * 0.5;
    assert.ok(Math.abs(elevationFromUpload(dem, lon, lat)! - 0) < 1e-6);
    const lon3 = ORIGIN.west + ORIGIN.scaleX * 3.5;
    assert.ok(Math.abs(elevationFromUpload(dem, lon3, lat)! - 30) < 1e-6);
  });

  it('interpolates between adjacent cells', () => {
    const lon = ORIGIN.west + ORIGIN.scaleX * 1.0; // midway between cell 0 (val 0) and cell 1 (val 10)
    const lat = ORIGIN.north - ORIGIN.scaleY * 0.5;
    const value = elevationFromUpload(dem, lon, lat)!;
    assert.ok(Math.abs(value - 5) < 1e-6, `${value}`);
  });

  it('is null outside the uploaded bounds', () => {
    assert.equal(elevationFromUpload(dem, dem.bounds.west - 1, ORIGIN.north), null);
    assert.equal(elevationFromUpload(dem, ORIGIN.west, dem.bounds.north + 1), null);
  });

  it('still answers right at the edge of the field, not just its centre', () => {
    assert.notEqual(elevationFromUpload(dem, dem.bounds.west, ORIGIN.north - ORIGIN.scaleY * 0.5), null);
  });
});

describe('elevationWithOverride', () => {
  const dem: UploadedDem = {
    width: 2,
    height: 2,
    heights: Float32Array.from([100, 100, 100, 100]),
    bounds: { west: -3.2, south: 55.958, east: -3.198, north: 55.96 },
  };

  it('prefers the upload wherever it covers the point', () => {
    const global = () => 5; // the "global DEM" always says 5 here
    const value = elevationWithOverride([dem], global, -3.199, 55.959);
    assert.equal(value, 100);
  });

  it('falls back to the global DEM outside the upload — issue #50\'s own requirement', () => {
    const global = () => 5;
    const value = elevationWithOverride([dem], global, 10, 10); // nowhere near the upload
    assert.equal(value, 5);
  });

  it('falls back cleanly when there is no upload at all', () => {
    const global = () => 42;
    assert.equal(elevationWithOverride([], global, 0, 0), 42);
  });

  it('passes through whatever the global DEM itself refuses to answer', () => {
    const global = () => null;
    assert.equal(elevationWithOverride([], global, 0, 0), null);
  });
});
