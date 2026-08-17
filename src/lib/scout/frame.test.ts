/**
 * Tests for the frame geometry.
 *
 * The cross-check throughout is similar triangles. `fieldOfView` works in
 * angles — 2·atan(d/2f) — while the ground footprint works in lengths, and the
 * two are the same statement seen from either end: sensorEdge/focal must equal
 * frameWidth/distance for every lens on every sensor. That identity holds only
 * if the rectilinear model is implemented correctly at both, which is why it is
 * worth more here than a table of published angles of view (those are quoted for
 * 36×24 anyway, and this file works in Sony's 35.9×24.0).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  APERTURES,
  CIRCLE_OF_CONFUSION_PX,
  EDGE_TOLERANCE_DEG,
  FLARE_BAND_DEG,
  FOCAL_LENGTHS,
  SENSORS,
  angleDelta,
  checkFraming,
  depthOfField,
  describeLens,
  equivalentFocalLength,
  fieldOfView,
  frameAxis,
  frameOffsetToSky,
  frameWedge,
  frameWidthAt,
  hyperfocalDistanceMm,
  projectToFrame,
  sensorByKey,
  type Fov,
  type Sensor,
} from './frame.ts';
import { distance, initialBearing, type LatLon } from './geo.ts';

const FF = SENSORS[0];
const APSC = SENSORS[1];
const EDINBURGH: LatLon = { lat: 55.9533, lon: -3.1883 };
const TROMSO: LatLon = { lat: 69.6496, lon: 18.956 };

const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} expected ${a} ≈ ${b} (±${tol})`);

/* ── Angles ────────────────────────────────────────────────────────────────── */

describe('angleDelta', () => {
  it('is zero for the same bearing however it is written', () => {
    assert.equal(angleDelta(10, 10), 0);
    assert.equal(angleDelta(10, 370), 0);
    assert.equal(angleDelta(-350, 10), 0);
  });

  it('takes the short way round the wrap', () => {
    assert.equal(angleDelta(350, 10), 20);
    assert.equal(angleDelta(10, 350), -20);
  });

  it('stays within (−180, 180]', () => {
    for (let a = -720; a <= 720; a += 7) {
      for (let b = -720; b <= 720; b += 13) {
        const d = angleDelta(a, b);
        assert.ok(d > -180 && d <= 180, `${a}→${b} gave ${d}`);
      }
    }
  });

  it('is antisymmetric except at the half turn', () => {
    for (let a = 0; a < 360; a += 11) {
      for (let b = 0; b < 360; b += 17) {
        const d = angleDelta(a, b);
        if (Math.abs(d) === 180) continue;
        close(angleDelta(b, a), -d, 1e-9);
      }
    }
  });
});

/* ── Field of view ─────────────────────────────────────────────────────────── */

describe('fieldOfView', () => {
  it('inverts back to the sensor it was measured from', () => {
    for (const sensor of SENSORS) {
      for (const focal of FOCAL_LENGTHS) {
        const fov = fieldOfView(sensor, focal);
        const acrossMm = 2 * focal * Math.tan((fov.horizontalDeg / 2) * (Math.PI / 180));
        const upMm = 2 * focal * Math.tan((fov.verticalDeg / 2) * (Math.PI / 180));
        close(acrossMm, sensor.widthMm, 1e-9, `${sensor.key} ${focal}mm across`);
        close(upMm, sensor.heightMm, 1e-9, `${sensor.key} ${focal}mm up`);
      }
    }
  });

  it('puts the diagonal outside both edges', () => {
    for (const sensor of SENSORS) {
      for (const focal of FOCAL_LENGTHS) {
        const fov = fieldOfView(sensor, focal);
        assert.ok(fov.diagonalDeg > fov.horizontalDeg);
        assert.ok(fov.horizontalDeg > fov.verticalDeg);
      }
    }
  });

  it('narrows as the lens gets longer, and never reaches 180°', () => {
    let previous = 180;
    for (const focal of FOCAL_LENGTHS) {
      const fov = fieldOfView(FF, focal);
      assert.ok(fov.horizontalDeg < previous, `${focal}mm was not narrower`);
      assert.ok(fov.diagonalDeg < 180);
      previous = fov.horizontalDeg;
    }
  });

  it('does not use the small-angle approximation at the wide end', () => {
    // d/f in radians is the naive form. At 16mm it overstates the field by
    // several degrees, which is the whole reason atan is there.
    const fov = fieldOfView(FF, 16);
    const naive = (FF.widthMm / 16) * (180 / Math.PI);
    assert.ok(naive - fov.horizontalDeg > 3, `naive ${naive} vs ${fov.horizontalDeg}`);
  });

  it('swaps the two edges in portrait and leaves the diagonal alone', () => {
    const land = fieldOfView(FF, 35, 'landscape');
    const port = fieldOfView(FF, 35, 'portrait');
    close(port.horizontalDeg, land.verticalDeg, 1e-12);
    close(port.verticalDeg, land.horizontalDeg, 1e-12);
    close(port.diagonalDeg, land.diagonalDeg, 1e-12);
  });

  it('refuses a focal length that is not a length', () => {
    for (const bad of [0, -50, NaN]) {
      assert.throws(() => fieldOfView(FF, bad), RangeError);
    }
  });
});

describe('equivalentFocalLength', () => {
  it('leaves full frame alone', () => {
    for (const focal of FOCAL_LENGTHS) close(equivalentFocalLength(FF, focal), focal, 1e-9);
  });

  it('gives Sony APS-C its real 1.53× crop, not the quoted 1.5', () => {
    const factor = equivalentFocalLength(APSC, 100) / 100;
    close(factor, 1.53, 0.01);
    assert.ok(factor > 1.5, 'the rounded 1.5 would be a smaller number');
  });

  it('matches the angle it stands for', () => {
    // A crop lens at its equivalent focal length must see the same diagonal on
    // full frame — that is what "equivalent" means.
    for (const sensor of SENSORS) {
      for (const focal of [16, 35, 85]) {
        const cropped = fieldOfView(sensor, focal).diagonalDeg;
        const full = fieldOfView(FF, equivalentFocalLength(sensor, focal)).diagonalDeg;
        close(cropped, full, 1e-9, `${sensor.key} ${focal}mm`);
      }
    }
  });
});

describe('sensorByKey', () => {
  it('finds every sensor it lists, and nothing else', () => {
    for (const sensor of SENSORS) assert.equal(sensorByKey(sensor.key), sensor);
    assert.equal(sensorByKey('imax'), undefined);
  });
});

/* ── The wedge ─────────────────────────────────────────────────────────────── */

describe('frameWedge', () => {
  it('is a closed ring starting and ending at the pin', () => {
    const wedge = frameWedge(EDINBURGH, 210, 60, 4000);
    const ring = wedge.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
    close(ring[0][0], EDINBURGH.lon, 1e-12);
    close(ring[0][1], EDINBURGH.lat, 1e-12);
  });

  it('opens exactly the field of view, split about the aim', () => {
    const fov = fieldOfView(FF, 24);
    const wedge = frameWedge(EDINBURGH, 100, fov.horizontalDeg, 8000);
    const ring = wedge.geometry.coordinates[0];
    const first = { lon: ring[1][0], lat: ring[1][1] };
    const last = { lon: ring[ring.length - 2][0], lat: ring[ring.length - 2][1] };
    close(initialBearing(EDINBURGH, first), 100 - fov.horizontalDeg / 2, 0.01);
    close(initialBearing(EDINBURGH, last), 100 + fov.horizontalDeg / 2, 0.01);
  });

  it('puts every arc point at the range, including at high latitude', () => {
    for (const centre of [EDINBURGH, TROMSO]) {
      const wedge = frameWedge(centre, 315, 74, 25_000);
      const ring = wedge.geometry.coordinates[0];
      for (const [lon, lat] of ring.slice(1, -1)) {
        close(distance(centre, { lat, lon }), 25_000, 1, 'arc radius');
      }
    }
  });

  it('keeps longitudes continuous across the antimeridian', () => {
    const wedge = frameWedge({ lat: -16.8, lon: 179.97 }, 90, 120, 40_000);
    const ring = wedge.geometry.coordinates[0];
    for (let i = 1; i < ring.length; i++) {
      assert.ok(Math.abs(ring[i][0] - ring[i - 1][0]) < 180, 'ring jumped the antimeridian');
    }
  });

  it('refuses a range or an opening that cannot be drawn', () => {
    assert.throws(() => frameWedge(EDINBURGH, 0, 60, 0), RangeError);
    assert.throws(() => frameWedge(EDINBURGH, 0, 0, 1000), RangeError);
    assert.throws(() => frameWedge(EDINBURGH, 0, 360, 1000), RangeError);
    assert.throws(() => frameWedge(EDINBURGH, 0, 60, 1000, 1), RangeError);
  });
});

describe('frameAxis', () => {
  it('runs from the pin along the aim, at the range', () => {
    const axis = frameAxis(EDINBURGH, 247, 5000);
    const [from, to] = axis.geometry.coordinates;
    close(from[0], EDINBURGH.lon, 1e-12);
    const far = { lat: to[1], lon: to[0] };
    close(distance(EDINBURGH, far), 5000, 0.5);
    close(initialBearing(EDINBURGH, far), 247, 0.01);
  });
});

/* ── The ground footprint ──────────────────────────────────────────────────── */

describe('frameWidthAt', () => {
  it('agrees with similar triangles on the sensor', () => {
    // sensorWidth / focal === frameWidth / distance. Two different routes to the
    // same rectilinear projection; if either end is wrong they disagree.
    for (const sensor of SENSORS) {
      for (const focal of FOCAL_LENGTHS) {
        for (const range of [50, 800, 12_000]) {
          const fov = fieldOfView(sensor, focal);
          const expected = (range * sensor.widthMm) / focal;
          close(frameWidthAt(fov, range), expected, 1e-6, `${sensor.key} ${focal}mm @${range}m`);
        }
      }
    }
  });

  it('scales linearly with distance', () => {
    const fov = fieldOfView(FF, 50);
    close(frameWidthAt(fov, 2000), 2 * frameWidthAt(fov, 1000), 1e-9);
  });
});

/* ── Framing the sun ───────────────────────────────────────────────────────── */

const AIM = { bearing: 270, tiltDeg: 0 };
const WIDE: Fov = fieldOfView(FF, 24); // ≈ 73.7° × 53.1°
const LONG: Fov = fieldOfView(FF, 200); // ≈ 10.3° × 6.9°

describe('checkFraming', () => {
  it('puts a target on the aim dead centre', () => {
    const check = checkFraming({ azimuth: 270, altitude: 0 }, AIM, WIDE);
    assert.equal(check.horizontalOffsetDeg, 0);
    assert.equal(check.verticalOffsetDeg, 0);
    assert.equal(check.inFrame, true);
    assert.equal(check.placement, 'in-frame');
    // Nearest edge on a landscape frame is the top or the bottom, never the side.
    close(check.edgeGapDeg, -WIDE.verticalDeg / 2, 0.05);
  });

  it('reads the offsets the way a photographer would', () => {
    const right = checkFraming({ azimuth: 290, altitude: 10 }, AIM, WIDE);
    assert.equal(right.horizontalOffsetDeg, 20);
    // Not 10. The offsets are measured on the image plane, and 20° off the axis
    // a subject 10° up sits 10.6° up the frame — atan(tan 10° / cos 20°). The
    // altitude difference is only the answer down the centre line.
    assert.equal(right.verticalOffsetDeg, 10.6);
    assert.match(right.note, /right of centre/);
    const left = checkFraming({ azimuth: 250, altitude: -10 }, AIM, WIDE);
    assert.equal(left.horizontalOffsetDeg, -20);
    assert.equal(left.verticalOffsetDeg, -10.6);
  });

  it('agrees with the field of view about where the edges are', () => {
    const halfH = WIDE.horizontalDeg / 2;
    const inside = checkFraming({ azimuth: 270 + halfH - 0.2, altitude: 0 }, AIM, WIDE);
    const outside = checkFraming({ azimuth: 270 + halfH + 0.2, altitude: 0 }, AIM, WIDE);
    assert.equal(inside.inFrame, true);
    assert.equal(outside.inFrame, false);
    close(inside.edgeGapDeg, -0.2, 0.06);
    close(outside.edgeGapDeg, 0.2, 0.06);
  });

  it('calls the last degree and a half an edge, not a yes', () => {
    const halfV = WIDE.verticalDeg / 2;
    const check = checkFraming({ azimuth: 270, altitude: halfV - 0.5 }, AIM, WIDE);
    assert.equal(check.inFrame, true);
    assert.equal(check.placement, 'edge');
    assert.ok(Math.abs(check.edgeGapDeg) < EDGE_TOLERANCE_DEG);
    assert.match(check.note, /model's own error/);
  });

  it('flags the flare band outside the frame but not far beyond it', () => {
    const halfH = LONG.horizontalDeg / 2;
    const near = checkFraming({ azimuth: 270 + halfH + 3, altitude: 0 }, AIM, LONG);
    const far = checkFraming({ azimuth: 270 + halfH + FLARE_BAND_DEG + 3, altitude: 0 }, AIM, LONG);
    assert.equal(near.placement, 'just-outside');
    assert.equal(near.flareRisk, true);
    assert.equal(far.placement, 'outside');
    assert.equal(far.flareRisk, false);
    assert.match(far.note, /lights the scene without being in it/);
  });

  it('knows the difference between out of frame and behind you', () => {
    const off = checkFraming({ azimuth: 270 + 60, altitude: 5 }, AIM, LONG);
    const back = checkFraming({ azimuth: 90, altitude: 5 }, AIM, LONG);
    assert.equal(off.placement, 'outside');
    assert.equal(back.placement, 'behind');
    assert.match(back.note, /Behind you/);
    // This module answers where the sun is relative to the *frame*, and stops
    // there. Whether that makes the subject front- or side-lit is
    // `lighting.ts`'s question, decided on a different threshold — the two
    // used to be printed on adjacent lines disagreeing about the same angle.
    assert.doesNotMatch(back.note, /lighting|lit\b/i);
  });

  it('solves the tilt that just brings a high sun into the top edge', () => {
    const check = checkFraming({ azimuth: 270, altitude: 48 }, AIM, WIDE);
    assert.equal(check.inFrame, false);
    assert.notEqual(check.tiltToIncludeDeg, null);
    // Applying it must land the sun exactly on the edge, by construction.
    const tilted = checkFraming({ azimuth: 270, altitude: 48 }, { bearing: 270, tiltDeg: check.tiltToIncludeDeg! }, WIDE);
    assert.equal(tilted.inFrame, true);
    // Inside, but by no more than the tenth of a degree the tilt was rounded by.
    assert.ok(tilted.edgeGapDeg <= 0 && tilted.edgeGapDeg >= -0.1, `landed at ${tilted.edgeGapDeg}`);
  });

  it('solves a downward tilt for something below the frame', () => {
    const check = checkFraming({ azimuth: 270, altitude: -40 }, AIM, WIDE);
    assert.ok(check.tiltToIncludeDeg! < 0);
    const tilted = checkFraming({ azimuth: 270, altitude: -40 }, { bearing: 270, tiltDeg: check.tiltToIncludeDeg! }, WIDE);
    assert.equal(tilted.inFrame, true);
  });

  it('offers no tilt when the camera would have to turn instead', () => {
    const check = checkFraming({ azimuth: 200, altitude: 60 }, AIM, LONG);
    assert.equal(check.tiltToIncludeDeg, null);
    assert.match(check.note, /edge/);
  });

  it('tracks a tilted camera the way the viewfinder does', () => {
    // Sun 30° up, camera level: outside a 24mm frame's 26.5° half-height.
    const level = checkFraming({ azimuth: 270, altitude: 30 }, { bearing: 270, tiltDeg: 0 }, WIDE);
    assert.equal(level.inFrame, false);
    // Tilt up 15° and it drops to 15° above centre — well inside.
    const tilted = checkFraming({ azimuth: 270, altitude: 30 }, { bearing: 270, tiltDeg: 15 }, WIDE);
    assert.equal(tilted.inFrame, true);
    assert.equal(tilted.verticalOffsetDeg, 15);
  });

  it('keeps a subject near the zenith in frame however far round it is in azimuth', () => {
    // The case the old Δazimuth test could not get right, and the one that
    // matters: aim 80° up and something 90° away in azimuth is five degrees
    // across the picture, not out of it. Meridians converge.
    const check = checkFraming({ azimuth: 90, altitude: 85 }, { bearing: 0, tiltDeg: 80 }, WIDE);
    assert.equal(check.inFrame, true);
    close(check.horizontalOffsetDeg, 5.1, 0.1);
    close(check.verticalOffsetDeg, 10.0, 0.1);
  });

  it('spreads azimuth across the frame when the camera is tilted up', () => {
    // Level, the horizon 20° off the aim is 20° across the frame. Tilt up 45°
    // and the same point is 27° across it — which is why a wide lens pointed up
    // takes in so much more of the skyline than the wedge on the map suggests.
    const level = checkFraming({ azimuth: 200, altitude: 0 }, { bearing: 180, tiltDeg: 0 }, WIDE);
    close(level.horizontalOffsetDeg, 20, 0.01);
    const tilted = checkFraming({ azimuth: 200, altitude: 0 }, { bearing: 180, tiltDeg: 45 }, WIDE);
    close(tilted.horizontalOffsetDeg, 27.2, 0.1);
    close(tilted.verticalOffsetDeg, -45, 0.01);
  });

  it('handles an aim that straddles north', () => {
    const check = checkFraming({ azimuth: 10, altitude: 0 }, { bearing: 350, tiltDeg: 0 }, WIDE);
    assert.equal(check.horizontalOffsetDeg, 20);
    assert.equal(check.inFrame, true);
  });

  it('grows the answer with the lens', () => {
    // One sun, one aim: wide includes it, long does not. This is the whole point.
    const target = { azimuth: 270 + 20, altitude: 8 };
    assert.equal(checkFraming(target, AIM, WIDE).inFrame, true);
    assert.equal(checkFraming(target, AIM, LONG).inFrame, false);
  });
});

/* ── The projection itself ─────────────────────────────────────────────────── */

describe('projectToFrame', () => {
  it('puts the aim at the origin, whatever the tilt', () => {
    for (const tiltDeg of [-60, -20, 0, 35, 80]) {
      const p = projectToFrame({ azimuth: 128, altitude: tiltDeg }, { bearing: 128, tiltDeg });
      close(p.acrossDeg, 0, 1e-9, `tilt ${tiltDeg} across`);
      close(p.upDeg, 0, 1e-9, `tilt ${tiltDeg} up`);
      assert.equal(p.ahead, true);
    }
  });

  it('reduces to the azimuth difference when the camera is level', () => {
    // A level frame's horizontal axis *is* a line of constant altitude, so on
    // that one case the naive difference is right — and it is worth pinning,
    // because it is the case every reading in the panel was checked against by
    // hand before the projection existed.
    for (let dAz = -80; dAz <= 80; dAz += 7) {
      for (const altitude of [-30, 0, 25, 60]) {
        const p = projectToFrame({ azimuth: 270 + dAz, altitude }, { bearing: 270, tiltDeg: 0 });
        close(p.acrossDeg, dAz, 1e-9, `Δaz ${dAz} at ${altitude}°`);
      }
    }
  });

  it('agrees with the spherical separation between the aim and the target', () => {
    // The independent identity: whatever the two frame angles are, the target's
    // distance from the optical axis must come out the same as the spherical law
    // of cosines makes it. tan(θ) = hypot(tan across, tan up), because both are
    // the same right-angled solid triangle read two ways. This shares no
    // arithmetic with `projectToFrame` and would catch any sign, axis or
    // basis-ordering slip in it.
    const rad = Math.PI / 180;
    for (const bearing of [0, 73, 180, 291]) {
      for (const tiltDeg of [-40, 0, 30, 75]) {
        for (let dAz = -170; dAz <= 170; dAz += 23) {
          for (const altitude of [-25, 0, 18, 55, 88]) {
            const p = projectToFrame({ azimuth: bearing + dAz, altitude }, { bearing, tiltDeg });
            if (!p.ahead) continue; // tan is meaningless once the target is behind
            const cosSep =
              Math.sin(altitude * rad) * Math.sin(tiltDeg * rad) +
              Math.cos(altitude * rad) * Math.cos(tiltDeg * rad) * Math.cos(dAz * rad);
            const separation = Math.acos(Math.min(1, Math.max(-1, cosSep)));
            const fromAngles = Math.atan(
              Math.hypot(Math.tan(p.acrossDeg * rad), Math.tan(p.upDeg * rad)),
            );
            close(fromAngles, separation, 1e-9, `${bearing}/${tiltDeg} → ${dAz}/${altitude}`);
          }
        }
      }
    }
  });

  it('calls anything past the image plane behind, not merely far off in azimuth', () => {
    // Level, "behind" and "90° of azimuth" are the same statement, and the old
    // test conflated them. Pointed 80° up they are nothing like it: a subject
    // 60° up on the *opposite* bearing is 40° off the axis and squarely in front
    // of the camera. Near the zenith every azimuth is in front of you.
    assert.equal(projectToFrame({ azimuth: 180, altitude: 0 }, { bearing: 0, tiltDeg: 0 }).ahead, false);
    const overhead = projectToFrame({ azimuth: 180, altitude: 60 }, { bearing: 0, tiltDeg: 80 });
    assert.equal(overhead.ahead, true);
    close(Math.hypot(overhead.acrossDeg, overhead.upDeg), 40, 1);
  });
});

describe('frameOffsetToSky', () => {
  it('is the exact inverse of projectToFrame, swept across aim, tilt and offset', () => {
    // The identity issue #48's dome overlay depends on: whatever
    // projectToFrame says a sky point's offsets are, running those offsets
    // back through frameOffsetToSky must recover a point projectToFrame
    // agrees is at that same offset — not necessarily the same azimuth and
    // altitude, since across ±180° in azimuth at the zenith is one point
    // under many names, but the same place on the image plane.
    for (const bearing of [0, 47, 180, 311]) {
      for (const tiltDeg of [-55, -20, 0, 35, 75]) {
        const aim = { bearing, tiltDeg };
        for (let across = -80; across <= 80; across += 17) {
          for (let up = -70; up <= 70; up += 17) {
            const sky = frameOffsetToSky(across, up, aim);
            const back = projectToFrame(sky, aim);
            assert.ok(back.ahead, `${bearing}/${tiltDeg} → ${across}/${up} landed behind the camera`);
            close(back.acrossDeg, across, 1e-6, `across at ${bearing}/${tiltDeg}`);
            close(back.upDeg, up, 1e-6, `up at ${bearing}/${tiltDeg}`);
          }
        }
      }
    }
  });

  it('puts dead centre at the aim itself', () => {
    for (const aim of [{ bearing: 0, tiltDeg: 0 }, { bearing: 210, tiltDeg: 40 }, { bearing: 88, tiltDeg: -30 }]) {
      const sky = frameOffsetToSky(0, 0, aim);
      close(sky.azimuth, ((aim.bearing % 360) + 360) % 360, 1e-9);
      close(sky.altitude, aim.tiltDeg, 1e-9);
    }
  });

  it('agrees with checkFraming about where the frame edges are', () => {
    // A second, independent cross-check: the sky point this function puts at
    // the frame's own top-right corner must checkFraming as in-frame (or on
    // the edge, for the tolerance the model already carries), and a point a
    // couple of degrees further out must not.
    const aim = { bearing: 270, tiltDeg: 10 };
    const fov = fieldOfView(FF, 35);
    const corner = frameOffsetToSky(fov.horizontalDeg / 2 - 0.5, fov.verticalDeg / 2 - 0.5, aim);
    assert.equal(checkFraming(corner, aim, fov).inFrame, true);
    const outside = frameOffsetToSky(fov.horizontalDeg / 2 + 3, fov.verticalDeg / 2 + 3, aim);
    assert.equal(checkFraming(outside, aim, fov).inFrame, false);
  });
});

describe('tiltToIncludeDeg', () => {
  it('is never offered unless it actually works', () => {
    // The promise the panel makes when it prints a tilt. Swept rather than
    // spot-checked because the closed form solves the vertical only, and tilting
    // swings the horizontal axis too — so the cases where the arithmetic is
    // right and the answer is still wrong are exactly the ones a hand-picked
    // example misses.
    let offered = 0;
    for (const fov of [WIDE, LONG]) {
      for (const tiltDeg of [-30, 0, 20, 70]) {
        for (let dAz = -180; dAz < 180; dAz += 11) {
          for (const altitude of [-45, -5, 12, 40, 78]) {
            const target = { azimuth: 270 + dAz, altitude };
            const check = checkFraming(target, { bearing: 270, tiltDeg }, fov);
            if (check.tiltToIncludeDeg == null) continue;
            offered++;
            const tilted = checkFraming(target, { bearing: 270, tiltDeg: check.tiltToIncludeDeg }, fov);
            assert.equal(
              tilted.inFrame,
              true,
              `${dAz}/${altitude} from tilt ${tiltDeg}: offered ${check.tiltToIncludeDeg}° and it did not land`,
            );
          }
        }
      }
    }
    assert.ok(offered > 50, `only ${offered} tilts were offered — the sweep proves nothing`);
  });

  it('is independent of the tilt the camera happens to be at', () => {
    // The answer is a property of the target and the lens, not of where the
    // camera is pointed now. Two photographers at different tilts must be told
    // the same number or one of them is being told a wrong one.
    const target = { azimuth: 270, altitude: 52 };
    const from0 = checkFraming(target, { bearing: 270, tiltDeg: 0 }, WIDE).tiltToIncludeDeg;
    const from30 = checkFraming(target, { bearing: 270, tiltDeg: -30 }, WIDE).tiltToIncludeDeg;
    assert.notEqual(from0, null);
    assert.equal(from0, from30);
  });
});

/* ── Words ─────────────────────────────────────────────────────────────────── */

describe('describeLens', () => {
  it('leaves a full-frame focal length unqualified', () => {
    const text = describeLens(FF, 24, fieldOfView(FF, 24));
    assert.match(text, /^24mm · 74° × 53°$/);
  });

  it('carries the equivalent for anything that is not full frame', () => {
    const text = describeLens(APSC, 24, fieldOfView(APSC, 24));
    assert.match(text, /24mm \(37mm equiv\.\)/);
  });
});

/* ── Depth of field ────────────────────────────────────────────────────────── */

describe('hyperfocalDistanceMm', () => {
  it('matches a published table: 50mm ƒ/8 at the classic 0.03mm circle gives ~10.47m', () => {
    close(hyperfocalDistanceMm(50, 8, 0.03), 10_466.7, 1);
  });

  it('grows with focal length and shrinks with a smaller aperture number', () => {
    const wide = hyperfocalDistanceMm(24, 8, 0.02);
    const long = hyperfocalDistanceMm(100, 8, 0.02);
    assert.ok(long > wide);
    const open = hyperfocalDistanceMm(50, 1.4, 0.02);
    const closed = hyperfocalDistanceMm(50, 16, 0.02);
    assert.ok(open > closed, 'a wider aperture (smaller N) pulls the hyperfocal distance out, not in');
  });

  it('refuses a non-positive focal length, aperture or circle', () => {
    assert.throws(() => hyperfocalDistanceMm(0, 8, 0.03), RangeError);
    assert.throws(() => hyperfocalDistanceMm(50, 0, 0.03), RangeError);
    assert.throws(() => hyperfocalDistanceMm(50, 8, 0), RangeError);
  });
});

describe('depthOfField', () => {
  it('puts the near limit at exactly half the hyperfocal distance when focused there', () => {
    // The identity this module is held to: focused at the hyperfocal distance,
    // everything from H/2 to infinity is sharp. True for any lens and any
    // circle of confusion, not just the one worked example.
    for (const focal of FOCAL_LENGTHS) {
      for (const aperture of APERTURES) {
        const circleMm = 0.02;
        const h = hyperfocalDistanceMm(focal, aperture, circleMm);
        const dof = depthOfField(focal, aperture, circleMm, h / 1000);
        close(dof.nearM, h / 2000, h / 1e6, `${focal}mm ƒ/${aperture}`);
        assert.equal(dof.farM, Infinity);
      }
    }
  });

  it('matches a published table at 50mm ƒ/8 focused at 5m', () => {
    const dof = depthOfField(50, 8, 0.03, 5);
    close(dof.nearM, 3.39, 0.01);
    close(dof.farM, 9.53, 0.01);
  });

  it('widens as the aperture number grows and as the lens gets wider', () => {
    const narrow = depthOfField(50, 2.8, 0.02, 5);
    const wide = depthOfField(50, 16, 0.02, 5);
    assert.ok(wide.spanM > narrow.spanM);
    const long = depthOfField(135, 8, 0.02, 5);
    const short = depthOfField(24, 8, 0.02, 5);
    assert.ok(short.spanM > long.spanM);
  });

  it('never puts the far limit closer than the near one', () => {
    for (const focus of [0.5, 2, 5, 20, 100]) {
      const dof = depthOfField(35, 4, 0.02, focus);
      assert.ok(dof.farM > dof.nearM);
      assert.ok(dof.nearM < focus && (dof.farM > focus || dof.farM === Infinity));
    }
  });

  it('refuses a focus distance that is not a distance', () => {
    assert.throws(() => depthOfField(50, 8, 0.03, 0), RangeError);
    assert.throws(() => depthOfField(50, 8, 0.03, -1), RangeError);
  });
});

describe('CIRCLE_OF_CONFUSION_PX', () => {
  it('is a small, stated number of pixels rather than a fitted constant', () => {
    assert.ok(CIRCLE_OF_CONFUSION_PX > 0 && CIRCLE_OF_CONFUSION_PX <= 5);
  });
});

/* ── The sensors themselves ────────────────────────────────────────────────── */

describe('SENSORS', () => {
  it('lists the body this was built for first, at Sony\'s real dimensions', () => {
    assert.equal(SENSORS[0].key, 'ff');
    assert.equal(SENSORS[0].widthMm, 35.9);
    assert.equal(SENSORS[0].heightMm, 24.0);
  });

  it('are all landscape-oriented, so the orientation swap means something', () => {
    for (const sensor of SENSORS as Sensor[]) {
      assert.ok(sensor.widthMm > sensor.heightMm, `${sensor.key} is not the long edge first`);
    }
  });
});
