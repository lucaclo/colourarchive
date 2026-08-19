import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  boundsOverlap,
  buildingHeight,
  buildingSetSignature,
  castPrisms,
  castShadow,
  castShadows,
  convexHull,
  heightIsEstimated,
  maxShadowLength,
  padBounds,
  pointInConvexRing,
  ringBounds,
  ringIntersects,
  shadowCeilingAt,
  squareFootprint,
  type Ring,
} from './shadows.ts';
import { destination, distance, initialBearing } from './geo.ts';
import { shadowLengthRatio } from './sun.ts';

/** A ~20m square footprint near the equator, where a degree is easy to reason about. */
const square = (lon = 0, lat = 0, sizeDeg = 0.0002): Ring => [
  [lon, lat],
  [lon + sizeDeg, lat],
  [lon + sizeDeg, lat + sizeDeg],
  [lon, lat + sizeDeg],
  [lon, lat],
];

const centroid = (ring: Ring) => {
  const pts = ring.slice(0, -1);
  return {
    lon: pts.reduce((s, p) => s + p[0], 0) / pts.length,
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
  };
};

describe('convexHull', () => {
  it('keeps the corners of a square and drops interior points', () => {
    const hull = convexHull([...square(), [0.0001, 0.0001]]);
    assert.equal(hull.length, 4);
  });

  it('survives duplicate and collinear points', () => {
    const hull = convexHull([
      [0, 0],
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    // Collinear midpoints on an edge are not corners.
    assert.equal(hull.length, 4);
  });

  it('returns the input when there is no area', () => {
    assert.equal(convexHull([[0, 0]]).length, 1);
    assert.equal(
      convexHull([
        [0, 0],
        [1, 1],
      ]).length,
      2,
    );
  });
});

describe('maxShadowLength', () => {
  it('is nothing at all without a sun', () => {
    for (const altitude of [0, -0.5, -20]) assert.equal(maxShadowLength(altitude), 0, `${altitude}`);
  });

  it('tightens as the sun grazes, because that is where the model is weakest', () => {
    let previous = -1;
    for (const altitude of [0.5, 2, 5, 10, 20]) {
      const value = maxShadowLength(altitude);
      assert.ok(value > previous, `${altitude}: ${value}`);
      previous = value;
    }
    // Above 20° the geometry no longer runs away, so the cap stops moving.
    assert.equal(maxShadowLength(60), maxShadowLength(20));
    // A dawn sun must not lay a kilometre and a half of shadow down from every
    // building in view — that was the bug, and the map went black.
    assert.ok(maxShadowLength(1) < 400, `${maxShadowLength(1)}`);
    assert.ok(maxShadowLength(45) >= 1500);
  });

  it('bites well before cot(altitude) does, at dawn', () => {
    // A 30m building at 1° geometrically throws 1.7km.
    const geometric = 30 * shadowLengthRatio(1);
    assert.ok(geometric > 1500);
    assert.ok(maxShadowLength(1) < geometric / 4);
  });
});

describe('castShadow', () => {
  it('caps at maxShadowLength by default, and says that it did', () => {
    const dawn = castShadow(square(), 30, 180, 1)!;
    assert.equal(dawn.lengthM, maxShadowLength(1));
    assert.equal(dawn.clipped, true);
    // High sun: nothing to cap, the geometry stands as computed.
    const noon = castShadow(square(), 30, 180, 50)!;
    assert.equal(noon.clipped, false);
    assert.ok(Math.abs(noon.lengthM - 30 * shadowLengthRatio(50)) < 1e-9);
  });

  it('throws the shadow directly away from the sun', () => {
    // Sun due east (90°) → shadow points due west (270°).
    const result = castShadow(square(), 20, 90, 45)!;
    assert.ok(result);
    const from = centroid(square());
    const to = centroid(result.ring);
    const bearing = initialBearing({ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon });
    assert.ok(Math.abs(bearing - 270) < 1, `shadow ran ${bearing}°`);
  });

  it('makes the shadow as long as the building is tall at 45°', () => {
    const height = 30;
    const result = castShadow(square(), height, 180, 45)!;
    assert.ok(Math.abs(result.lengthM - height) < 0.01, `${result.lengthM}`);
    assert.equal(result.clipped, false);
  });

  it('lengthens the shadow as the sun drops', () => {
    const lengths = [60, 30, 15, 5].map((alt) => castShadow(square(), 20, 180, alt)!.lengthM);
    for (let i = 1; i < lengths.length; i++) {
      assert.ok(lengths[i] > lengths[i - 1], `${lengths}`);
    }
    // And matches cot(altitude) exactly.
    assert.ok(Math.abs(lengths[0] - 20 * shadowLengthRatio(60)) < 1e-6);
  });

  it('contains the building footprint itself', () => {
    const foot = square();
    const result = castShadow(foot, 25, 200, 30)!;
    // Every footprint corner is within the hull's bounding box at minimum.
    const lons = result.ring.map((p) => p[0]);
    const lats = result.ring.map((p) => p[1]);
    for (const [lon, lat] of foot) {
      assert.ok(lon >= Math.min(...lons) - 1e-12 && lon <= Math.max(...lons) + 1e-12);
      assert.ok(lat >= Math.min(...lats) - 1e-12 && lat <= Math.max(...lats) + 1e-12);
    }
  });

  it('caps a runaway shadow and says that it did', () => {
    // 30m at 0.6° would be nearly 3km.
    const result = castShadow(square(), 30, 180, 0.6, { maxLengthM: 800 })!;
    assert.equal(result.lengthM, 800);
    assert.equal(result.clipped, true);
  });

  it('refuses when there is no sun, no height, or no outline', () => {
    assert.equal(castShadow(square(), 20, 180, 0), null);
    assert.equal(castShadow(square(), 20, 180, -10), null);
    assert.equal(castShadow(square(), 0, 180, 45), null);
    assert.equal(castShadow(square(), -5, 180, 45), null);
    assert.equal(castShadow([[0, 0]], 20, 180, 45), null);
  });

  it('returns a properly closed ring', () => {
    const result = castShadow(square(), 20, 45, 30)!;
    assert.deepEqual(result.ring[0], result.ring[result.ring.length - 1]);
    assert.ok(result.ring.length >= 4);
  });

  it('displaces by the right ground distance', () => {
    const height = 40;
    const altitude = 20;
    const result = castShadow(square(), height, 0, altitude)!;
    const expected = height * shadowLengthRatio(altitude);
    // The far edge of the hull should sit `expected` metres from the near edge.
    const from = centroid(square());
    const far = result.ring.reduce((best, p) => {
      const d = distance({ lat: from.lat, lon: from.lon }, { lat: p[1], lon: p[0] });
      return d > best.d ? { d, p } : best;
    }, { d: -1, p: [0, 0] as [number, number] });
    // Centroid-to-far-corner is the shadow length plus half the diagonal.
    assert.ok(far.d > expected * 0.9 && far.d < expected * 1.3, `${far.d} vs ${expected}`);
  });
});

describe('the shadow ceiling', () => {
  it('is the building height over the footprint and nothing at the tip', () => {
    const height = 30;
    const result = castShadow(square(), height, 180, 45)!;
    // Sun due south, shadow due north: the southern vertices are the footprint's
    // own, the northern ones the far end of the throw.
    const south = Math.min(...result.ring.map(([, lat]) => lat));
    const north = Math.max(...result.ring.map(([, lat]) => lat));
    for (const [i, [, lat]] of result.ring.entries()) {
      if (lat === south) assert.equal(result.ceilings[i], height, 'at the wall');
      if (lat === north) assert.ok(result.ceilings[i] < 1e-9, `at the tip: ${result.ceilings[i]}`);
    }
  });

  it('never exceeds the height, so a building is never in its own shadow', () => {
    for (const altitude of [5, 20, 45, 70]) {
      const result = castShadow(square(), 40, 135, altitude)!;
      for (const ceiling of result.ceilings) {
        assert.ok(ceiling <= 40 + 1e-9, `${ceiling} at ${altitude}°`);
        assert.ok(ceiling >= 0, `${ceiling} at ${altitude}°`);
      }
    }
  });

  it('stays above the ground where the throw was cut short', () => {
    // At 1° the true shadow is far longer than the cap, so the drawn tip is
    // still well up in the air — and saying so is the difference between a
    // shadow that stops and one that has ended.
    const clipped = castShadow(square(), 30, 180, 1)!;
    assert.equal(clipped.clipped, true);
    assert.ok(Math.max(...clipped.ceilings) > 20, 'the near end is at full height');
    assert.ok(Math.min(...clipped.ceilings) > 1, `cut off at ${Math.min(...clipped.ceilings)}m`);
  });

  it('falls at tan(altitude) per metre down the throw', () => {
    // Measured on a clipped shadow, because that is the one whose tip has a
    // ceiling left to check: an uncapped shadow always ends at zero, which the
    // slope would satisfy at any gradient.
    const height = 30;
    const altitude = 1;
    const result = castShadow(square(), height, 180, altitude)!;
    assert.equal(result.clipped, true);
    const lowest = Math.min(...result.ceilings);
    const expected = height - result.lengthM * Math.tan((altitude * Math.PI) / 180);
    // Centimetres, not exact: the throw is placed by a geodesic solve and the
    // ceiling is measured against a flat metres-per-degree, so the two disagree
    // by a fraction of a metre over a 360m shadow. Against a height taken from
    // a storey count that is nothing.
    assert.ok(Math.abs(lowest - expected) < 0.05, `${lowest} vs ${expected}`);
  });

  it('carries one ceiling per ring vertex, closing vertex included', () => {
    const result = castShadow(square(), 20, 210, 35)!;
    assert.equal(result.ceilings.length, result.ring.length);
    assert.equal(result.ceilings[0], result.ceilings[result.ceilings.length - 1]);
  });
});

describe('pointInConvexRing', () => {
  it('holds for the centroid of a square', () => {
    assert.equal(pointInConvexRing(square(), 0.0001, 0.0001), true);
  });

  it('fails for a point well outside it', () => {
    assert.equal(pointInConvexRing(square(), 1, 1), false);
  });

  it('counts a point exactly on an edge as inside', () => {
    assert.equal(pointInConvexRing(square(), 0.0001, 0), true);
  });

  it('refuses a degenerate ring rather than guessing', () => {
    assert.equal(pointInConvexRing([[0, 0], [1, 1]], 0.5, 0.5), false);
  });
});

describe('ringBounds and boundsOverlap', () => {
  it('reduces a ring to its own bounding box', () => {
    const b = ringBounds(square(0, 0, 0.0002));
    assert.deepEqual(b, { west: 0, south: 0, east: 0.0002, north: 0.0002 });
  });

  it('agrees with ringIntersects on the same pairs', () => {
    const box = { west: 0, south: 0, east: 0.001, north: 0.001 };
    for (const ring of [square(0.0002, 0.0002), square(0.01, 0.01)]) {
      assert.equal(boundsOverlap(ringBounds(ring), box), ringIntersects(ring, box));
    }
  });

  it('touching edges count as overlap, same as ringIntersects does', () => {
    assert.equal(
      boundsOverlap({ west: 0, south: 0, east: 1, north: 1 }, { west: 1, south: 1, east: 2, north: 2 }),
      true,
    );
  });
});

describe('shadowCeilingAt', () => {
  it('matches castShadow’s own per-vertex ceiling, evaluated at that vertex', () => {
    const result = castShadow(square(), 30, 200, 25)!;
    for (const [i, [lon, lat]] of result.ring.entries()) {
      const c = shadowCeilingAt(result, lon, lat);
      assert.ok(c !== null, `vertex ${i} of the shadow's own ring read as outside it`);
      assert.ok(Math.abs(c! - result.ceilings[i]) < 1e-6, `${c} vs ${result.ceilings[i]}`);
    }
  });

  it('is null well outside the shadow’s own footprint', () => {
    const result = castShadow(square(), 30, 200, 25)!;
    assert.equal(shadowCeilingAt(result, 5, 5), null);
  });

  it('is exactly the building height on its own footprint, so a building never shades its own wall', () => {
    const result = castShadow(square(), 30, 180, 45)!;
    const c = shadowCeilingAt(result, 0.0001, 0.0001); // the footprint's own centroid
    assert.ok(c !== null);
    assert.ok(Math.abs(c! - 30) < 1e-9, `${c}`);
  });

  it('only ever falls moving further down-sun, never rises', () => {
    // Sun due south (azimuth 180) throws the shadow north, so latitude alone
    // tracks "further down-sun" here without needing the bearing math.
    const result = castShadow(square(), 30, 180, 20)!;
    const samples = [0.0002, 0.0006, 0.0012, 0.002]
      .map((lat) => shadowCeilingAt(result, 0.0001, lat))
      .filter((c): c is number => c !== null);
    assert.ok(samples.length >= 2, 'need at least two in-footprint samples to compare');
    for (let i = 1; i < samples.length; i++) {
      assert.ok(samples[i] <= samples[i - 1] + 1e-9, `${samples[i]} rose above ${samples[i - 1]}`);
    }
  });
});

describe('buildingHeight', () => {
  it('prefers a rendered height', () => {
    assert.equal(buildingHeight({ render_height: 18, height: 4, 'building:levels': 2 }), 18);
    assert.equal(heightIsEstimated({ render_height: 18 }), false);
  });

  it('falls back to a measured height', () => {
    assert.equal(buildingHeight({ height: 12 }), 12);
    assert.equal(heightIsEstimated({ height: 12 }), false);
  });

  it('estimates from storeys, and admits it', () => {
    assert.ok(Math.abs(buildingHeight({ 'building:levels': 5 }) - 16) < 1e-9);
    assert.equal(heightIsEstimated({ 'building:levels': 5 }), true);
  });

  it('gives nothing when there is nothing to go on', () => {
    assert.equal(buildingHeight({}), 0);
    assert.equal(buildingHeight(null), 0);
    assert.equal(buildingHeight({ render_height: 0 }), 0);
    assert.equal(heightIsEstimated({}), true);
  });
});

describe('castShadows', () => {
  const buildings = [
    { ring: square(0, 0), height: 20 },
    { ring: square(0.001, 0), height: 40, estimated: true },
    { ring: square(0.002, 0), height: 0 },
  ];

  it('casts every building that has a height and counts the rest', () => {
    const result = castShadows(buildings, 180, 30);
    assert.equal(result.cast, 2);
    assert.equal(result.skippedNoHeight, 1);
    assert.equal(result.collection.features.length, 2);
    assert.equal(result.collection.type, 'FeatureCollection');
  });

  it('carries the estimated flag through so drawing can be honest', () => {
    const result = castShadows(buildings, 180, 30);
    assert.deepEqual(
      result.collection.features.map((f) => f.properties?.estimated),
      [false, true],
    );
  });

  it('carries the throw length, so the style can fade the far end', () => {
    const result = castShadows(buildings, 180, 30);
    const lengths = result.collection.features.map((f) => f.properties?.lengthM as number);
    assert.deepEqual(
      lengths,
      [20, 40].map((h) => Math.round(h * shadowLengthRatio(30))),
    );
    // Longer means less certain, and the fade downstream depends on that order.
    assert.ok(lengths[1] > lengths[0]);
  });

  it('reports the longest shadow and any clipping', () => {
    const result = castShadows(buildings, 180, 30);
    assert.ok(Math.abs(result.longestM - 40 * shadowLengthRatio(30)) < 1e-6);
    assert.equal(result.clipped, 0);

    const low = castShadows(buildings, 180, 1, { maxLengthM: 500 });
    assert.equal(low.clipped, 2);
  });

  it('produces nothing at all once the sun is down', () => {
    const result = castShadows(buildings, 180, -2);
    assert.equal(result.cast, 0);
    assert.deepEqual(result.collection.features, []);
  });

  it('keeps the tallest when it has to drop some', () => {
    const many = [
      { ring: square(0, 0), height: 5 },
      { ring: square(0.001, 0), height: 100 },
      { ring: square(0.002, 0), height: 50 },
      { ring: square(0.003, 0), height: 8 },
    ];
    const result = castShadows(many, 180, 30, { limit: 2 });
    assert.equal(result.cast, 2);
    assert.equal(result.omitted, 2);
    // The 100m tower throws the longest shadow, so it must be one of the two.
    assert.ok(Math.abs(result.longestM - 100 * shadowLengthRatio(30)) < 1e-6);
  });

  it('does not drop anything when it fits', () => {
    const result = castShadows(buildings, 180, 30, { limit: 100 });
    assert.equal(result.omitted, 0);
  });
});

describe('viewport filtering', () => {
  const box = { west: 0, south: 0, east: 0.001, north: 0.001 };

  it('keeps footprints that touch the box', () => {
    assert.equal(ringIntersects(square(0.0002, 0.0002), box), true);
    // Straddling the edge still counts.
    assert.equal(ringIntersects(square(-0.0001, 0.0005), box), true);
  });

  it('drops footprints entirely outside it', () => {
    assert.equal(ringIntersects(square(0.01, 0.01), box), false);
    assert.equal(ringIntersects(square(-0.01, 0), box), false);
  });

  it('grows the box by roughly the right number of metres', () => {
    const padded = padBounds({ west: 0, south: 0, east: 0.01, north: 0.01 }, 1000);
    // ~1km is about 0.009° of latitude.
    assert.ok(Math.abs(padded.north - 0.01 - 0.00898) < 0.0005, `${padded.north}`);
    assert.ok(padded.west < 0 && padded.south < 0 && padded.east > 0.01);
  });

  it('does not blow up padding near the poles', () => {
    const padded = padBounds({ west: 0, south: 89.9, east: 1, north: 89.99 }, 5000);
    assert.ok(Number.isFinite(padded.west) && Number.isFinite(padded.east));
  });
});

describe('squareFootprint', () => {
  const CENTRE = { lat: 35.6595, lon: 139.7005 };

  it('is a closed square of the requested side', () => {
    const ring = squareFootprint(CENTRE, 20);
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[4]);
    for (let i = 0; i < 4; i++) {
      const a = { lat: ring[i][1], lon: ring[i][0] };
      const b = { lat: ring[(i + 1) % 4][1], lon: ring[(i + 1) % 4][0] };
      assert.ok(Math.abs(distance(a, b) - 20) < 0.1, `side ${i}: ${distance(a, b)}`);
    }
  });

  it('centres on the point it was given', () => {
    const ring = squareFootprint(CENTRE, 40);
    for (const [lon, lat] of ring.slice(0, 4)) {
      const reach = distance(CENTRE, { lat, lon });
      assert.ok(Math.abs(reach - (40 * Math.SQRT2) / 2) < 0.1, `corner at ${reach}m`);
    }
  });

  it('stays square where the meridians converge', () => {
    const arctic = { lat: 78.2, lon: 15.6 };
    const ring = squareFootprint(arctic, 30);
    for (let i = 0; i < 4; i++) {
      const a = { lat: ring[i][1], lon: ring[i][0] };
      const b = { lat: ring[(i + 1) % 4][1], lon: ring[(i + 1) % 4][0] };
      assert.ok(Math.abs(distance(a, b) - 30) < 0.2, `side ${i} at 78°N: ${distance(a, b)}`);
    }
  });

  it('turns with the bearing it is given', () => {
    const north = squareFootprint(CENTRE, 20, 0);
    const turned = squareFootprint(CENTRE, 20, 45);
    assert.ok(Math.abs(north[0][0] - turned[0][0]) > 1e-7, 'rotation should move the corners');
    // A 90° turn maps the square onto itself, corner for corner.
    const quarter = squareFootprint(CENTRE, 20, 90);
    assert.ok(Math.abs(quarter[0][0] - north[1][0]) < 1e-9);
    assert.ok(Math.abs(quarter[0][1] - north[1][1]) < 1e-9);
  });

  it('refuses a slab with no size', () => {
    assert.throws(() => squareFootprint(CENTRE, 0), RangeError);
    assert.throws(() => squareFootprint(CENTRE, -5), RangeError);
  });

  it('casts a shadow of exactly the height it was told', () => {
    // The one shadow on the map with no guessing in it: a 10 m slab at 45°
    // throws 10 m, and that has to come out of the same caster as the buildings.
    const shadow = castShadow(squareFootprint(CENTRE, 4), 10, 180, 45);
    assert.ok(shadow);
    assert.ok(Math.abs(shadow.lengthM - 10) < 0.01, `${shadow.lengthM}m`);
    assert.equal(shadow.clipped, false);
  });
});

describe('the shared shadow offset', () => {
  /**
   * The optimisation replaced one geodesic solve per vertex with one per
   * building, applying the first corner's displacement to the whole footprint.
   * This measures what that costs, rather than trusting the comment about it.
   */
  it('agrees with a per-vertex geodesic solve to within four centimetres', () => {
    let worst = 0;
    for (const lat of [0, 35.66, 51.5, 70, -45]) {
      for (const lengthM of [10, 120, 900, 1500]) {
        for (const bearing of [0, 47, 135, 268, 359]) {
          // A generous footprint: most buildings are far smaller than 60 m, and
          // the error grows with footprint size, not with the shadow.
          const footprint = squareFootprint({ lat, lon: 12 }, 60);
          const anchor = footprint[0];
          const moved = destination({ lat: anchor[1], lon: anchor[0] }, bearing, lengthM);
          const dLon = moved.lon - anchor[0];
          const dLat = moved.lat - anchor[1];

          for (const [lon, pointLat] of footprint) {
            const exact = destination({ lat: pointLat, lon }, bearing, lengthM);
            const approx = { lat: pointLat + dLat, lon: lon + dLon };
            worst = Math.max(worst, distance(exact, approx));
          }
        }
      }
    }
    // The measured worst case, at 70° with a 60 m footprint and a 1.5 km throw.
    // Tightening this without re-measuring would be asserting a precision the
    // approximation does not have; loosening it would stop catching a change.
    assert.ok(worst < 0.05, `worst vertex was ${worst.toFixed(4)} m out`);
  });

  it('still throws exactly as far as it claims', () => {
    for (const lat of [0, 51.5, 70, -45]) {
      const height = 100;
      const altitude = 45;
      const shadow = castShadow(squareFootprint({ lat, lon: 12 }, 4), height, 180, altitude, {
        maxLengthM: 5000,
      })!;
      assert.ok(shadow);
      assert.ok(Math.abs(shadow.lengthM - height) < 1e-9, `${lat}°: ${shadow.lengthM}`);
      // And the hull genuinely reaches that far north of the footprint.
      const northmost = Math.max(...shadow.ring.map((p) => p[1]));
      const footNorth = Math.max(...squareFootprint({ lat, lon: 12 }, 4).map((p) => p[1]));
      const reach = distance({ lat: footNorth, lon: 12 }, { lat: northmost, lon: 12 });
      assert.ok(Math.abs(reach - height) < 0.5, `${lat}°: reached ${reach.toFixed(2)} m`);
    }
  });

  it('shifts a footprint without distorting it', () => {
    // Parallel translation: the sides must keep their lengths, not shear.
    const footprint = squareFootprint({ lat: 70, lon: 12 }, 80);
    const moved = destination({ lat: footprint[0][1], lon: footprint[0][0] }, 90, 1200);
    const dLon = moved.lon - footprint[0][0];
    const dLat = moved.lat - footprint[0][1];
    const shifted: Ring = footprint.map(([lon, lat]) => [lon + dLon, lat + dLat]);
    for (let i = 0; i < 4; i++) {
      const before = distance(
        { lat: footprint[i][1], lon: footprint[i][0] },
        { lat: footprint[i + 1][1], lon: footprint[i + 1][0] },
      );
      const after = distance(
        { lat: shifted[i][1], lon: shifted[i][0] },
        { lat: shifted[i + 1][1], lon: shifted[i + 1][0] },
      );
      assert.ok(Math.abs(before - after) < 0.02, `side ${i}: ${before} vs ${after}`);
    }
  });
});

describe('fingerprinting a gathered set of buildings', () => {
  const at = (lon: number, lat: number, height: number) => ({
    ring: [
      [lon, lat],
      [lon + 0.0001, lat],
      [lon + 0.0001, lat + 0.0001],
      [lon, lat + 0.0001],
      [lon, lat],
    ] as Ring,
    height,
  });

  const a = at(-3.19, 55.95, 20);
  const b = at(-3.191, 55.951, 34);
  const c = at(-3.192, 55.952, 12);

  it('does not care what order the tiles arrived in', () => {
    // `querySourceFeatures` walks whichever tiles it holds, in no promised
    // order, so the same city gathered twice must fingerprint the same.
    assert.equal(buildingSetSignature([a, b, c]), buildingSetSignature([c, a, b]));
    assert.equal(buildingSetSignature([a, b, c]), buildingSetSignature([b, c, a]));
  });

  it('notices a swap that leaves the count alone', () => {
    // The bug this exists for: panning one building out and another in.
    assert.notEqual(buildingSetSignature([a, b]), buildingSetSignature([a, c]));
  });

  it('notices a height changing under a fixed footprint', () => {
    assert.notEqual(buildingSetSignature([a]), buildingSetSignature([at(-3.19, 55.95, 21)]));
  });

  it('notices a building being added, removed or duplicated', () => {
    assert.notEqual(buildingSetSignature([a, b]), buildingSetSignature([a]));
    assert.notEqual(buildingSetSignature([a, b]), buildingSetSignature([a, b, c]));
    // Same sum is possible in principle; the count is carried so it cannot pass.
    assert.notEqual(buildingSetSignature([a, a]), buildingSetSignature([a]));
  });

  it('is stable across repeated calls, which is the whole point', () => {
    assert.equal(buildingSetSignature([a, b, c]), buildingSetSignature([a, b, c]));
  });

  it('answers for an empty set without special-casing it', () => {
    assert.equal(buildingSetSignature([]), buildingSetSignature([]));
    assert.notEqual(buildingSetSignature([]), buildingSetSignature([a]));
  });

  it('survives a footprint with no vertices rather than throwing', () => {
    assert.doesNotThrow(() => buildingSetSignature([{ ring: [] as Ring, height: 10 }]));
  });
});

describe('a precomputed hull is the same answer, not a cheaper one', () => {
  /** A footprint with plenty of interior and collinear clutter to throw away. */
  const messy = (): Ring => {
    const ring: Ring = [];
    // A rough octagon, plus midpoints on every edge that the hull must drop.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ring.push([-0.09 + 0.0004 * Math.cos(a), 51.51 + 0.00025 * Math.sin(a)]);
      const b = ((i + 0.5) / 8) * Math.PI * 2;
      ring.push([-0.09 + 0.00028 * Math.cos(b), 51.51 + 0.000175 * Math.sin(b)]);
    }
    ring.push(ring[0]);
    return ring;
  };

  it('produces an identical ring and identical ceilings, at every sun', () => {
    const footprint = messy();
    const hull = convexHull(footprint);
    for (const azimuth of [0, 37, 90, 174, 268, 359]) {
      for (const altitude of [1, 4.5, 20, 55, 80]) {
        const plain = castShadow(footprint, 24, azimuth, altitude);
        const fast = castShadow(footprint, 24, azimuth, altitude, { hull });
        assert.deepEqual(fast, plain, `azimuth ${azimuth}, altitude ${altitude}`);
      }
    }
  });

  it('holds for a degenerate footprint too', () => {
    // Three points and a closing repeat: the hull is the footprint, and the
    // fast path must not quietly drop it.
    const triangle: Ring = [
      [-0.09, 51.51],
      [-0.0899, 51.51],
      [-0.0899, 51.5101],
      [-0.09, 51.51],
    ];
    assert.deepEqual(
      castShadow(triangle, 12, 200, 30, { hull: convexHull(triangle) }),
      castShadow(triangle, 12, 200, 30),
    );
  });

  it('castPrisms passes each building its own hull', () => {
    // The guard against the obvious way to break this: one building's hull
    // reaching another building's cast.
    const a = messy();
    const b: Ring = a.map(([lon, lat]) => [lon + 0.002, lat + 0.001]);
    const withHulls = castPrisms(
      [
        { ring: a, height: 30, hull: convexHull(a) },
        { ring: b, height: 18, hull: convexHull(b) },
      ],
      120,
      25,
    );
    const without = castPrisms(
      [
        { ring: a, height: 30 },
        { ring: b, height: 18 },
      ],
      120,
      25,
    );
    assert.deepEqual(withHulls, without);
  });
});
