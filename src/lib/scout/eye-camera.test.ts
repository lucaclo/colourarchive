import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EYE_FAR_DETAIL_M,
  EYE_TERRAIN_BIAS,
  EYE_TERRAIN_TILES_HIGH,
  EYE_TERRAIN_TILES_LOW,
  EYE_PITCH_MAX,
  EYE_PITCH_MIN,
  EYE_PIVOT_M,
  clampEyePitch,
  degreesPerPixel,
  eyeTileZoom,
  lookTarget,
  nextTerrainBias,
  pixelsPerMetre,
  turnHead,
} from './eye-camera';

const eye = { lon: 7.6586, lat: 45.9763, altM: 3001.7 };
const RAD = Math.PI / 180;
/** Metres between two points, flat-earth, fine over a few hundred metres. */
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => {
  const north = (b.lat - a.lat) * RAD * 6371008.8;
  const east = (b.lon - a.lon) * RAD * 6371008.8 * Math.cos(a.lat * RAD);
  return { north, east };
};

test('level gaze north puts the target the pivot distance north at eye height', () => {
  const t = lookTarget(eye, 0, 90);
  const d = metres(eye, t);
  assert.ok(Math.abs(d.north - EYE_PIVOT_M) < 1e-6);
  assert.ok(Math.abs(d.east) < 1e-6);
  assert.ok(Math.abs(t.altM - eye.altM) < 1e-9);
});

test('bearing 90 looks east', () => {
  const d = metres(eye, lookTarget(eye, 90, 90));
  assert.ok(Math.abs(d.east - EYE_PIVOT_M) < 1e-6);
  assert.ok(Math.abs(d.north) < 1e-6);
});

test('looking down puts the target below the eye, looking up above it', () => {
  const down = lookTarget(eye, 0, 30);
  assert.ok(Math.abs(eye.altM - down.altM - EYE_PIVOT_M * Math.cos(30 * RAD)) < 1e-9);
  assert.ok(Math.abs(metres(eye, down).north - EYE_PIVOT_M * Math.sin(30 * RAD)) < 1e-6);
  const up = lookTarget(eye, 0, 120);
  assert.ok(up.altM > eye.altM);
});

test('the target is always the pivot distance from the eye', () => {
  for (const [bearing, pitch] of [[0, 30], [137, 90], [-60, 120], [250, 75]]) {
    const t = lookTarget(eye, bearing, pitch);
    const d = metres(eye, t);
    const dist = Math.hypot(d.north, d.east, t.altM - eye.altM);
    assert.ok(Math.abs(dist - EYE_PIVOT_M) < 1e-3, `${bearing}/${pitch}: ${dist}`);
  }
});

test('pitch stays inside what standing allows', () => {
  assert.equal(clampEyePitch(10), EYE_PITCH_MIN);
  assert.equal(clampEyePitch(170), EYE_PITCH_MAX);
  assert.equal(clampEyePitch(95), 95);
});

test('a drag across the canvas height turns the view by the field of view', () => {
  const k = degreesPerPixel(36.87, 900);
  const turned = turnHead({ bearing: 0, pitch: 90 }, 0, 900 / 4, k);
  assert.ok(Math.abs(turned.pitch - (90 + 36.87 / 4)) < 1e-9);
});

test('drag right turns left, drag down looks up, and bearing wraps', () => {
  const k = degreesPerPixel(36.87, 900);
  const right = turnHead({ bearing: 10, pitch: 90 }, 100, 0, k);
  assert.ok(right.bearing < 10);
  assert.ok(turnHead({ bearing: 0, pitch: 90 }, 0, 50, k).pitch > 90);
  const wrapped = turnHead({ bearing: -175, pitch: 90 }, 300, 0, k);
  assert.ok(wrapped.bearing > 0 && wrapped.bearing <= 180, String(wrapped.bearing));
});

// MapLibre's arguments for a tile at `metres` from the eye, with the centre
// `EYE_PIVOT_M` away: distances in Mercator units, here 1 unit = 1 m.
const at = (zoom: (...a: [number, number, number, number, number]) => number, metres: number) =>
  zoom(20, metres, 0, EYE_PIVOT_M, 36.87);

test('standing detail falls one zoom for each doubling of distance', () => {
  const zoom = eyeTileZoom();
  assert.ok(Math.abs(at(zoom, 1000) - at(zoom, 2000) - 1) < 1e-9);
  assert.ok(Math.abs(at(zoom, 8000) - at(zoom, 32000) - 2) < 1e-9);
});

test('standing detail ignores the glancing angle that zeroes MapLibre\'s own', () => {
  const zoom = eyeTileZoom();
  // Camera height over the centre is about nil standing; it must not matter.
  assert.equal(zoom(20, 1000, 0, EYE_PIVOT_M, 36.87), zoom(20, 1000, 50, EYE_PIVOT_M, 36.87));
  assert.ok(at(zoom, 1000) > 13, String(at(zoom, 1000)));
});

test('the tile under the eye asks for a finite zoom', () => {
  const zoom = eyeTileZoom();
  assert.ok(Number.isFinite(at(zoom, 0)));
});

test('terrain is coarser by its bias and capped', () => {
  const scene = eyeTileZoom();
  const terrain = eyeTileZoom({ bias: 1, maxZoom: 17 });
  assert.ok(Math.abs(at(scene, 5000) - at(terrain, 5000) - 1) < 1e-9);
  assert.equal(at(terrain, 1), 17);
});

test('past the far distance detail falls away faster', () => {
  const zoom = eyeTileZoom();
  const near = at(zoom, EYE_FAR_DETAIL_M / 2) - at(zoom, EYE_FAR_DETAIL_M);
  const far = at(zoom, EYE_FAR_DETAIL_M) - at(zoom, EYE_FAR_DETAIL_M * 2);
  assert.ok(Math.abs(near - 1) < 1e-9);
  assert.ok(Math.abs(far - 4) < 1e-9);
});

test('pixels per metre matches MapLibre at the equator and halves at 60°', () => {
  const worldSize = 512 * 2 ** 20;
  const equator = pixelsPerMetre(worldSize, 0);
  assert.ok(Math.abs(equator - worldSize / (2 * Math.PI * 6371008.8)) < 1e-9);
  assert.ok(Math.abs(pixelsPerMetre(worldSize, 60) / equator - 2) < 1e-9);
});

test('terrain coarsens while over the cache, refines once well under, and holds between', () => {
  assert.equal(nextTerrainBias(1, EYE_TERRAIN_TILES_HIGH + 5), 1.5);
  assert.equal(nextTerrainBias(1.5, EYE_TERRAIN_TILES_HIGH), 1.5);
  assert.equal(nextTerrainBias(1.5, EYE_TERRAIN_TILES_LOW), 1.5);
  assert.equal(nextTerrainBias(2, EYE_TERRAIN_TILES_LOW - 1), 1.5);
  assert.equal(nextTerrainBias(EYE_TERRAIN_BIAS, 3), EYE_TERRAIN_BIAS);
  let bias = EYE_TERRAIN_BIAS;
  for (let i = 0; i < 50; i++) bias = nextTerrainBias(bias, 500);
  assert.equal(bias, 4);
});

test('a bias given as a function is read on every call', () => {
  let bias = 0;
  const zoom = eyeTileZoom({ bias: () => bias });
  const before = at(zoom, 5000);
  bias = 2;
  assert.ok(Math.abs(before - at(zoom, 5000) - 2) < 1e-9);
});
