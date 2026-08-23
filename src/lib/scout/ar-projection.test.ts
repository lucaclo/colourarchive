/**
 * Tests for the AR overlay's screen projection.
 *
 * The cross-checks mirror `frame.test.ts`'s: `checkFraming` decides on/off
 * screen (so those two must never disagree about the same target), and the
 * on-screen position is checked against the `tan`-based rectilinear model
 * directly — the same one `fieldOfView` and `frameWidthAt` are already held to
 * — rather than against a linear-in-degrees shortcut this module explicitly
 * rejects.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { projectToScreen } from './ar-projection.ts';
import {
  checkFraming,
  fieldOfView,
  frameOffsetToSky,
  SENSORS,
  type Aim,
  type Fov,
} from './frame.ts';

const FF = SENSORS[0];
const AIM: Aim = { bearing: 270, tiltDeg: 0 };
const WIDE: Fov = fieldOfView(FF, 24); // ≈ 73.7° × 53.1°
const LONG: Fov = fieldOfView(FF, 200); // ≈ 10.3° × 6.9°

const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} expected ${a} ≈ ${b} (±${tol})`);

const RAD = Math.PI / 180;
/** The same tan-based model the module is built on, computed independently. */
const expectedXY = (acrossDeg: number, upDeg: number, fov: Fov) => ({
  x: 0.5 + 0.5 * (Math.tan(acrossDeg * RAD) / Math.tan((fov.horizontalDeg / 2) * RAD)),
  y: 0.5 - 0.5 * (Math.tan(upDeg * RAD) / Math.tan((fov.verticalDeg / 2) * RAD)),
});

describe('projectToScreen', () => {
  it('puts a target on the aim at the dead centre of the screen', () => {
    const p = projectToScreen({ azimuth: 270, altitude: 0 }, AIM, WIDE);
    assert.equal(p.onScreen, true);
    if (p.onScreen) {
      close(p.x, 0.5, 1e-9);
      close(p.y, 0.5, 1e-9);
    }
  });

  it('matches the tan-based rectilinear model, not a linear-in-degrees one', () => {
    // The exact case SCOUT-HANDOFF documents for frame.ts: 20° off axis and
    // 10° up reads 10.6° up the frame, not 10° — because the frame's vertical
    // axis is not a line of constant altitude once you are off centre. This
    // checks the same case through to a screen position, against the tan
    // model computed independently in this file.
    const target = { azimuth: 290, altitude: 10 };
    const p = projectToScreen(target, AIM, WIDE);
    assert.equal(p.onScreen, true);
    if (!p.onScreen) return;

    const check = checkFraming(target, AIM, WIDE);
    close(check.verticalOffsetDeg, 10.6, 0.05, 'sanity: the documented case');

    const expected = expectedXY(check.horizontalOffsetDeg, check.verticalOffsetDeg, WIDE);
    close(p.x, expected.x, 0.01, 'x');
    close(p.y, expected.y, 0.01, 'y');

    // And the linear-in-degrees shortcut this module refuses to take would
    // give a visibly different answer here — proving the two models actually
    // diverge for this input rather than coincidentally agreeing.
    const linearY = 0.5 - 0.5 * (check.verticalOffsetDeg / (WIDE.verticalDeg / 2));
    assert.ok(Math.abs(p.y - linearY) > 0.001, 'tan and linear models unexpectedly agreed');
  });

  it('reads right as increasing x and up as decreasing y', () => {
    const right = projectToScreen({ azimuth: 280, altitude: 0 }, AIM, WIDE);
    const left = projectToScreen({ azimuth: 260, altitude: 0 }, AIM, WIDE);
    const up = projectToScreen({ azimuth: 270, altitude: 8 }, AIM, WIDE);
    const down = projectToScreen({ azimuth: 270, altitude: -8 }, AIM, WIDE);
    assert.ok(right.onScreen && left.onScreen && up.onScreen && down.onScreen);
    if (right.onScreen && left.onScreen) assert.ok(right.x > 0.5 && left.x < 0.5);
    if (up.onScreen && down.onScreen) assert.ok(up.y < 0.5 && down.y > 0.5);
  });

  it('never leaves the [0,1]×[0,1] square while on screen', () => {
    for (let dAz = -80; dAz <= 80; dAz += 5) {
      for (let alt = -50; alt <= 80; alt += 5) {
        const p = projectToScreen({ azimuth: 270 + dAz, altitude: alt }, AIM, WIDE);
        if (!p.onScreen) continue;
        assert.ok(p.x >= 0 && p.x <= 1, `x=${p.x} at ${dAz}/${alt}`);
        assert.ok(p.y >= 0 && p.y <= 1, `y=${p.y} at ${dAz}/${alt}`);
      }
    }
  });

  it('reports an off-screen target with the gap in degrees, never a clamp or a silent drop', () => {
    const halfH = LONG.horizontalDeg / 2;
    const target = { azimuth: 270 + halfH + 5, altitude: 0 };
    const p = projectToScreen(target, AIM, LONG);
    const check = checkFraming(target, AIM, LONG);
    assert.equal(p.onScreen, false);
    if (p.onScreen) return;
    close(p.edgeGapDeg, check.edgeGapDeg, 1e-6);
    assert.ok(p.edgeGapDeg > 0);
    assert.equal(p.note, check.note);
    assert.equal(p.edge, 'right');
  });

  it('names the top or bottom edge when that axis overran more, not always the sides', () => {
    const halfV = WIDE.verticalDeg / 2;
    const above = projectToScreen({ azimuth: 270, altitude: halfV + 6 }, AIM, WIDE);
    const below = projectToScreen({ azimuth: 270, altitude: -halfV - 6 }, AIM, WIDE);
    assert.equal(above.onScreen, false);
    assert.equal(below.onScreen, false);
    if (above.onScreen || below.onScreen) return;
    assert.equal(above.edge, 'top');
    assert.equal(below.edge, 'bottom');
  });

  it('agrees with checkFraming about exactly where the edge is', () => {
    const halfH = WIDE.horizontalDeg / 2;
    const justIn = projectToScreen({ azimuth: 270 + halfH - 0.2, altitude: 0 }, AIM, WIDE);
    const justOut = projectToScreen({ azimuth: 270 + halfH + 0.2, altitude: 0 }, AIM, WIDE);
    assert.equal(justIn.onScreen, true);
    assert.equal(justOut.onScreen, false);
    if (justIn.onScreen) close(justIn.x, 1, 0.05, 'just inside the right edge');
  });

  it('draws a target on the model\'s own edge tolerance, same as the panel calls it "on" the edge', () => {
    const halfV = WIDE.verticalDeg / 2;
    const target = { azimuth: 270, altitude: halfV - 0.5 };
    const check = checkFraming(target, AIM, WIDE);
    assert.equal(check.placement, 'edge');
    const p = projectToScreen(target, AIM, WIDE);
    assert.equal(p.onScreen, true);
    if (p.onScreen) assert.ok(p.y >= 0 && p.y <= 1);
  });

  it('reports behind-the-camera targets off screen with a large, finite gap, not a wrapped-around position', () => {
    const behind = { azimuth: 90, altitude: 5 };
    const p = projectToScreen(behind, AIM, LONG);
    assert.equal(p.onScreen, false);
    if (p.onScreen) return;
    assert.ok(Number.isFinite(p.edgeGapDeg));
    assert.match(p.note, /Behind you/);
  });

  it('round-trips through frameOffsetToSky: a sky point placed at a known frame offset lands at the tan-model screen position for that offset', () => {
    for (const fov of [WIDE, LONG]) {
      for (const aim of [AIM, { bearing: 40, tiltDeg: 25 }, { bearing: 190, tiltDeg: -15 }]) {
        for (const [across, up] of [
          [0, 0],
          [10, 5],
          [-15, 8],
          [5, -12],
        ] as const) {
          const halfH = fov.horizontalDeg / 2;
          const halfV = fov.verticalDeg / 2;
          if (Math.abs(across) >= halfH || Math.abs(up) >= halfV) continue;
          const sky = frameOffsetToSky(across, up, aim);
          const p = projectToScreen(sky, aim, fov);
          assert.equal(p.onScreen, true, `${aim.bearing}/${aim.tiltDeg} @ ${across}/${up}`);
          if (!p.onScreen) continue;
          const expected = expectedXY(across, up, fov);
          close(p.x, expected.x, 1e-6, `x at ${across}/${up}`);
          close(p.y, expected.y, 1e-6, `y at ${across}/${up}`);
        }
      }
    }
  });

  it('is a pure function of its three inputs — same target, aim and fov give the same answer', () => {
    const target = { azimuth: 300, altitude: 20 };
    const a = projectToScreen(target, AIM, WIDE);
    const b = projectToScreen(target, AIM, WIDE);
    assert.deepEqual(a, b);
  });
});
