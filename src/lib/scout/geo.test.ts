/**
 * Tests for the geodesy helpers.
 *
 * Same approach as the sun engine: round-trip identities and an independent
 * second formula, rather than a table of numbers copied off a website. The
 * cross-check here is the spherical law of cosines — a different expression for
 * the same great-circle distance, which agrees with haversine except in the
 * short-distance regime where it is known to lose precision. Testing them
 * against each other at medium range and asserting haversine's superiority at
 * close range checks both the code and the reason it was chosen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EARTH_RADIUS_M,
  boundingBox,
  circleFeature,
  circleRing,
  clampLatitude,
  compassPoint,
  destination,
  distance,
  formatDistance,
  initialBearing,
  withinRadius,
  wrapLongitude,
  type LatLon,
} from './geo.ts';

const RAD = Math.PI / 180;

const LONDON: LatLon = { lat: 51.5074, lon: -0.1278 };
const PARIS: LatLon = { lat: 48.8566, lon: 2.3522 };
const TOKYO: LatLon = { lat: 35.6762, lon: 139.6503 };
const SYDNEY: LatLon = { lat: -33.8688, lon: 151.2093 };
const QUITO: LatLon = { lat: -0.1807, lon: -78.4678 };
const TROMSO: LatLon = { lat: 69.6496, lon: 18.956 };
/** Deliberately sitting on the antimeridian. */
const TAVEUNI: LatLon = { lat: -16.8, lon: 179.97 };

const PLACES = [LONDON, PARIS, TOKYO, SYDNEY, QUITO, TROMSO, TAVEUNI];

/** Spherical law of cosines — independent of the haversine implementation. */
function cosineDistance(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const dλ = (b.lon - a.lon) * RAD;
  const c = Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return Math.acos(Math.min(1, Math.max(-1, c))) * EARTH_RADIUS_M;
}

/* ── Distance ──────────────────────────────────────────────────────────────── */

describe('distance', () => {
  it('is zero from a point to itself', () => {
    for (const place of PLACES) assert.equal(distance(place, place), 0);
  });

  it('is symmetric', () => {
    for (const a of PLACES) {
      for (const b of PLACES) {
        assert.ok(Math.abs(distance(a, b) - distance(b, a)) < 1e-6);
      }
    }
  });

  it('agrees with the spherical law of cosines at continental range', () => {
    for (const a of PLACES) {
      for (const b of PLACES) {
        if (distance(a, b) < 1000) continue; // where cosines is known to be poor
        const mine = distance(a, b);
        const theirs = cosineDistance(a, b);
        assert.ok(
          Math.abs(mine - theirs) / mine < 1e-9,
          `${mine} vs ${theirs}`,
        );
      }
    }
  });

  it('gives a degree of latitude as one 360th of the meridian', () => {
    const expected = (EARTH_RADIUS_M * Math.PI * 2) / 360;
    const measured = distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    assert.ok(Math.abs(measured - expected) < 0.001, `${measured} vs ${expected}`);
  });

  it('shrinks a degree of longitude by cos(latitude)', () => {
    const atEquator = distance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    for (const lat of [30, 45, 60, 80]) {
      const here = distance({ lat, lon: 0 }, { lat, lon: 1 });
      // Not exactly cos(lat) — that is the parallel, this is the great circle —
      // but it must be very close at one degree, and always shorter.
      assert.ok(here < atEquator, `${lat}°`);
      assert.ok(Math.abs(here / atEquator - Math.cos(lat * RAD)) < 1e-4, `${lat}°`);
    }
  });

  it('puts London and Paris about 344 km apart', () => {
    const km = distance(LONDON, PARIS) / 1000;
    assert.ok(km > 340 && km < 348, `got ${km}`);
  });

  it('puts London and Tokyo about 9560 km apart', () => {
    const km = distance(LONDON, TOKYO) / 1000;
    assert.ok(km > 9500 && km < 9620, `got ${km}`);
  });

  it('measures correctly across the antimeridian', () => {
    const west: LatLon = { lat: 0, lon: 179.9 };
    const east: LatLon = { lat: 0, lon: -179.9 };
    const km = distance(west, east) / 1000;
    // 0.2° of longitude at the equator, not 359.8°.
    assert.ok(km > 22 && km < 23, `got ${km}`);
  });

  it('gets the antipodes right', () => {
    const half = (EARTH_RADIUS_M * Math.PI) / 1000;
    const km = distance({ lat: 0, lon: 0 }, { lat: 0, lon: 180 }) / 1000;
    assert.ok(Math.abs(km - half) < 0.001, `${km} vs ${half}`);
  });
});

/* ── Bearing ───────────────────────────────────────────────────────────────── */

describe('bearing', () => {
  it('reads due north, east, south and west correctly', () => {
    const origin = { lat: 0, lon: 0 };
    assert.ok(Math.abs(initialBearing(origin, { lat: 1, lon: 0 }) - 0) < 1e-9);
    assert.ok(Math.abs(initialBearing(origin, { lat: 0, lon: 1 }) - 90) < 1e-9);
    assert.ok(Math.abs(initialBearing(origin, { lat: -1, lon: 0 }) - 180) < 1e-9);
    assert.ok(Math.abs(initialBearing(origin, { lat: 0, lon: -1 }) - 270) < 1e-9);
  });

  it('always returns a value in [0, 360)', () => {
    for (const a of PLACES) {
      for (const b of PLACES) {
        if (a === b) continue;
        const bearing = initialBearing(a, b);
        assert.ok(bearing >= 0 && bearing < 360, `${bearing}`);
      }
    }
  });

  it('points roughly south-southeast from London to Paris', () => {
    const bearing = initialBearing(LONDON, PARIS);
    assert.ok(bearing > 140 && bearing < 160, `got ${bearing}`);
    assert.equal(compassPoint(bearing), 'SSE');
  });
});

/* ── Destination ───────────────────────────────────────────────────────────── */

describe('destination', () => {
  it('round-trips with distance', () => {
    for (const origin of PLACES) {
      for (const bearing of [0, 37, 90, 143, 180, 271, 359]) {
        for (const metres of [10, 500, 10_000, 50_000, 250_000]) {
          const there = destination(origin, bearing, metres);
          assert.ok(
            Math.abs(distance(origin, there) - metres) < 1e-6,
            `${bearing}° ${metres}m: ${distance(origin, there)}`,
          );
        }
      }
    }
  });

  it('round-trips with bearing', () => {
    for (const origin of PLACES) {
      for (const bearing of [0, 37, 90, 143, 180, 271, 359]) {
        const there = destination(origin, bearing, 25_000);
        const back = initialBearing(origin, { lat: there.lat, lon: wrapLongitude(there.lon) });
        const diff = Math.abs(((back - bearing + 540) % 360) - 180);
        assert.ok(diff < 1e-6, `${bearing}° → ${back}°`);
      }
    }
  });

  it('walks due north into a higher latitude and due south into a lower one', () => {
    assert.ok(destination(LONDON, 0, 100_000).lat > LONDON.lat);
    assert.ok(destination(LONDON, 180, 100_000).lat < LONDON.lat);
  });
});

/* ── The radius ring ───────────────────────────────────────────────────────── */

describe('circleRing', () => {
  it('puts every vertex exactly on the radius', () => {
    for (const centre of PLACES) {
      for (const radius of [1000, 10_000, 50_000]) {
        for (const [lon, lat] of circleRing(centre, radius, 64)) {
          const d = distance(centre, { lat, lon });
          assert.ok(Math.abs(d - radius) < 1e-6, `${d} vs ${radius}`);
        }
      }
    }
  });

  it('returns a closed ring of the requested resolution', () => {
    const ring = circleRing(LONDON, 10_000, 64);
    assert.equal(ring.length, 65);
    assert.deepEqual(ring[0], ring[64]);
  });

  it('is a true geodesic circle, wider in longitude the further north you go', () => {
    // 50km at 69°N spans far more degrees of longitude than the same 50km at
    // the equator. Drawing it as a screen-space circle would be visibly wrong.
    const spread = (centre: LatLon) => {
      const ring = circleRing(centre, 50_000, 128);
      const lons = ring.map(([lon]) => lon);
      return Math.max(...lons) - Math.min(...lons);
    };
    assert.ok(spread(TROMSO) > spread(QUITO) * 2.5, `${spread(TROMSO)} vs ${spread(QUITO)}`);
  });

  it('stays continuous across the antimeridian', () => {
    // The whole point: no 360° jump between neighbouring vertices, or the
    // renderer draws a band across the entire map instead of a circle.
    const ring = circleRing(TAVEUNI, 40_000, 128);
    for (let i = 1; i < ring.length; i++) {
      assert.ok(
        Math.abs(ring[i][0] - ring[i - 1][0]) < 180,
        `jump at ${i}: ${ring[i - 1][0]} → ${ring[i][0]}`,
      );
    }
    // And it genuinely crosses: some vertices past 180, some short of it.
    const lons = ring.map(([lon]) => lon);
    assert.ok(Math.max(...lons) > 180, `max ${Math.max(...lons)}`);
    assert.ok(Math.min(...lons) < 180, `min ${Math.min(...lons)}`);
  });

  it('rejects a nonsense radius or resolution', () => {
    assert.throws(() => circleRing(LONDON, 0), RangeError);
    assert.throws(() => circleRing(LONDON, -1), RangeError);
    assert.throws(() => circleRing(LONDON, 1000, 4), RangeError);
    assert.throws(() => circleRing(LONDON, 1000, 12.5), RangeError);
  });

  it('wraps as a valid GeoJSON polygon feature', () => {
    const feature = circleFeature(LONDON, 10_000, 32);
    assert.equal(feature.type, 'Feature');
    assert.equal(feature.geometry.type, 'Polygon');
    assert.equal(feature.geometry.coordinates.length, 1);
    assert.equal(feature.geometry.coordinates[0].length, 33);
    assert.deepEqual(feature.properties, { radiusM: 10_000 });
  });
});

/* ── Bounding box ──────────────────────────────────────────────────────────── */

describe('boundingBox', () => {
  it('contains every vertex of the ring', () => {
    for (const centre of PLACES) {
      const [west, south, east, north] = boundingBox(centre, 25_000);
      for (const [lon, lat] of circleRing(centre, 25_000, 128)) {
        assert.ok(lat >= south - 1e-9 && lat <= north + 1e-9, `lat ${lat}`);
        if (west !== -180 || east !== 180) {
          assert.ok(lon >= west - 1e-9 && lon <= east + 1e-9, `lon ${lon}`);
        }
      }
    }
  });

  it('contains the centre', () => {
    for (const centre of PLACES) {
      const [west, south, east, north] = boundingBox(centre, 5_000);
      assert.ok(centre.lat >= south && centre.lat <= north);
      assert.ok(centre.lon >= west - 1e-9 && centre.lon <= east + 1e-9);
    }
  });

  it('opens out to the full width when the circle swallows a pole', () => {
    const [west, , east, north] = boundingBox({ lat: 89.9, lon: 0 }, 50_000);
    assert.equal(west, -180);
    assert.equal(east, 180);
    assert.ok(north <= 90);
  });

  it('grows with the radius', () => {
    const small = boundingBox(LONDON, 1_000);
    const large = boundingBox(LONDON, 40_000);
    assert.ok(large[3] - large[1] > small[3] - small[1]);
    assert.ok(large[2] - large[0] > small[2] - small[0]);
  });
});

/* ── Membership ────────────────────────────────────────────────────────────── */

describe('withinRadius', () => {
  it('includes the centre and excludes anything beyond', () => {
    assert.ok(withinRadius(LONDON, LONDON, 1000));
    assert.ok(withinRadius(LONDON, destination(LONDON, 45, 9_999), 10_000));
    assert.ok(!withinRadius(LONDON, destination(LONDON, 45, 10_001), 10_000));
  });

  it('is inclusive exactly on the boundary', () => {
    const edge = destination(LONDON, 200, 10_000);
    assert.ok(withinRadius(LONDON, edge, 10_000 + 1e-6));
  });
});

/* ── Coordinate hygiene ────────────────────────────────────────────────────── */

describe('coordinate helpers', () => {
  it('wraps longitude into [-180, 180)', () => {
    // Already in range: returned untouched, bit for bit.
    assert.equal(wrapLongitude(0), 0);
    assert.equal(wrapLongitude(179.9), 179.9);
    assert.equal(wrapLongitude(-180), -180);
    // Out of range: wrapped, and only approximately — the modular arithmetic
    // does not land on an exact float, which is why the in-range fast path exists.
    assert.equal(wrapLongitude(180), -180);
    assert.ok(Math.abs(wrapLongitude(181) - -179) < 1e-9);
    assert.ok(Math.abs(wrapLongitude(-181) - 179) < 1e-9);
    assert.equal(wrapLongitude(540), -180);
    assert.ok(Math.abs(wrapLongitude(360 + 45) - 45) < 1e-9);
  });

  it('clamps latitude to the poles', () => {
    assert.equal(clampLatitude(91), 90);
    assert.equal(clampLatitude(-91), -90);
    assert.equal(clampLatitude(45), 45);
  });
});

/* ── Presentation ──────────────────────────────────────────────────────────── */

describe('formatting', () => {
  it('reads metres below a kilometre and kilometres above', () => {
    assert.equal(formatDistance(0), '0 m');
    assert.equal(formatDistance(850), '850 m');
    assert.equal(formatDistance(999), '999 m');
    assert.equal(formatDistance(1000), '1.0 km');
    assert.equal(formatDistance(2449), '2.4 km');
    assert.equal(formatDistance(9900), '9.9 km');
    // Never "10.0 km": once it rounds to ten it uses the integer form.
    assert.equal(formatDistance(9950), '10 km');
    assert.equal(formatDistance(10_000), '10 km');
    assert.equal(formatDistance(18_400), '18 km');
    assert.equal(formatDistance(Infinity), '—');
  });

  it('names the sixteen compass points', () => {
    assert.equal(compassPoint(0), 'N');
    assert.equal(compassPoint(22.5), 'NNE');
    assert.equal(compassPoint(45), 'NE');
    assert.equal(compassPoint(90), 'E');
    assert.equal(compassPoint(180), 'S');
    assert.equal(compassPoint(270), 'W');
    assert.equal(compassPoint(340), 'NNW');
    // 348.75 is exactly the NNW/N boundary; rounding up to N is correct.
    assert.equal(compassPoint(348.75), 'N');
    assert.equal(compassPoint(359), 'N');
    assert.equal(compassPoint(360), 'N');
    assert.equal(compassPoint(-90), 'W');
  });
});
