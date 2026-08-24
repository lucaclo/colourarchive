import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { nightCameraConstraintsFor, nightCameraPullbackM } from './night-camera.ts';

describe('nightCameraPullbackM', () => {
  it('halves with every zoom level, at a fixed latitude', () => {
    for (const zoom of [10, 15, 18, 20, 21]) {
      const a = nightCameraPullbackM(zoom, 0);
      const b = nightCameraPullbackM(zoom + 1, 0);
      assert.ok(Math.abs(b - a / 2) < 1e-6, `${zoom}: ${a} → ${b}`);
    }
  });

  it('shrinks moving away from the equator, at a fixed zoom', () => {
    const equator = nightCameraPullbackM(18, 0);
    const midLat = nightCameraPullbackM(18, 51.5);
    const highLat = nightCameraPullbackM(18, 78);
    assert.ok(equator > midLat && midLat > highLat, `${equator} / ${midLat} / ${highLat}`);
  });
});

describe('nightCameraConstraintsFor', () => {
  it('reproduces the original fixed-dome design at its own 4000m case', () => {
    // The original NIGHT_ZOOM_MIN (20) and NIGHT_PIVOT_ELEVATION_M (500) were
    // hand-tuned for exactly this dome radius, at the equator (the worst-case
    // latitude the original comment reasoned about).
    const { zoom, pivotElevationM } = nightCameraConstraintsFor(4000, 0);
    assert.ok(Math.abs(zoom - 20) < 0.05, `zoom: ${zoom}`);
    assert.ok(pivotElevationM > 490 && pivotElevationM < 520, `pivotElevationM: ${pivotElevationM}`);
  });

  it('never lets the pivot sit below the real pull-back at the chosen zoom', () => {
    for (const domeRadiusM of [180, 500, 1200, 4000, 10_000, 50_000]) {
      for (const lat of [0, 35, 60, 80]) {
        const { zoom, pivotElevationM } = nightCameraConstraintsFor(domeRadiusM, lat);
        const realPullback = nightCameraPullbackM(zoom, lat);
        assert.ok(
          pivotElevationM > realPullback,
          `radius ${domeRadiusM} lat ${lat}: pivot ${pivotElevationM} <= pullback ${realPullback}`,
        );
      }
    }
  });

  it('clamps to the MapLibre zoom ceiling once the dome is too small to reach the target ratio', () => {
    const { zoom } = nightCameraConstraintsFor(180, 0);
    assert.equal(zoom, 22);
  });

  it('loosens the zoom floor as the dome grows, once past the ceiling-clamped range', () => {
    const radii = [2000, 5000, 10_000, 25_000, 50_000];
    let previousZoom = Infinity;
    for (const r of radii) {
      const { zoom } = nightCameraConstraintsFor(r, 0);
      assert.ok(zoom <= previousZoom, `${r}: ${zoom} > ${previousZoom}`);
      assert.ok(zoom >= 0 && zoom <= 22, `${r}: ${zoom}`);
      previousZoom = zoom;
    }
  });

  it('needs less zoom away from the equator, for the same dome', () => {
    const { zoom: atEquator } = nightCameraConstraintsFor(4000, 0);
    const { zoom: atHighLat } = nightCameraConstraintsFor(4000, 60);
    assert.ok(atHighLat < atEquator, `${atHighLat} >= ${atEquator}`);
  });
});
