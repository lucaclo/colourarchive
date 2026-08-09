/**
 * Tests for the night-sky half of the lens.
 *
 * There is no published table to check trailing against — every source quotes
 * one of the two rules of thumb this module deliberately does not use. So the
 * cross-checks here are identities that share no arithmetic with the code:
 * a star on the celestial equator must go round in exactly one sidereal day; a
 * pixel pitch must multiply back up to the sensor it came from; the shutter and
 * the trail must invert each other; and every point on a sampled rim must be
 * the stated angular distance from its centre by the spherical law of cosines.
 *
 * The two rules *are* here, once, as a calibration: if the arithmetic put the
 * NPF rule at thirty pixels of trail rather than three, something would be
 * wrong by an order of magnitude and no identity above would notice.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEGAPIXELS,
  RESOLUTIONS,
  SIDEREAL_DAY_SECONDS,
  SIDEREAL_RATE_DEG_PER_SEC,
  TOLERABLE_TRAIL_PX,
  driftRateDegPerSec,
  formatShutter,
  frameRegion,
  frameTheCore,
  inFrameWindows,
  pixelPitchMm,
  shutterForTrailSeconds,
  trailLimit,
  trailPixels,
} from './astrophoto.ts';
import { SENSORS, fieldOfView, sensorByKey, type Fov } from './frame.ts';
import { CORE_J2000, CORE_SPAN_DEG } from './galactic.ts';

const FF = SENSORS[0];
const MFT = sensorByKey('mft')!;
const WIDE: Fov = fieldOfView(FF, 24); // ≈ 73.7° × 53.1°
const LONG: Fov = fieldOfView(FF, 200); // ≈ 10.3° × 6.9°

/** The a7C II: 35.9 × 24.0 mm over 7008 × 4672 pixels. */
const A7CII_PITCH_MM = 35.9 / 7008;
const CORE_DEC = CORE_J2000.declination; // ≈ −29°

const close = (a: number, b: number, tol: number, what = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${what} expected ${a} ≈ ${b} (±${tol})`);

/* ── Pixel pitch ───────────────────────────────────────────────────────────── */

describe('pixelPitchMm', () => {
  it('multiplies back up to the sensor it was derived from', () => {
    // The identity: pitch × pixels across = the sensor's width, and the pixel
    // count is the megapixels it was asked for. Both must hold at once or the
    // aspect ratio has been dropped somewhere.
    for (const sensor of SENSORS) {
      for (const megapixels of RESOLUTIONS) {
        const pitch = pixelPitchMm(sensor, megapixels);
        const across = sensor.widthMm / pitch;
        const up = sensor.heightMm / pitch;
        close(across * up, megapixels * 1e6, megapixels * 1e-3, `${sensor.key} @${megapixels}MP`);
      }
    }
  });

  it('lands on the a7C II\'s real pixel pitch', () => {
    // The body the default is for. Sony publishes 7008 × 4672; the derivation
    // assumes square pixels filling the area, and the two agree to a fifth of a
    // percent — which is the whole claim the module header makes.
    const derived = pixelPitchMm(FF, DEFAULT_MEGAPIXELS);
    close(derived, A7CII_PITCH_MM, A7CII_PITCH_MM * 0.003, 'a7C II pitch');
  });

  it('shrinks the pixel as the count rises, on every format', () => {
    for (const sensor of SENSORS) {
      let previous = Infinity;
      for (const megapixels of RESOLUTIONS) {
        const pitch = pixelPitchMm(sensor, megapixels);
        assert.ok(pitch < previous, `${sensor.key} @${megapixels}MP did not shrink`);
        previous = pitch;
      }
    }
  });

  it('gives a smaller sensor a smaller pixel at the same count', () => {
    assert.ok(pixelPitchMm(MFT, 24) < pixelPitchMm(FF, 24));
  });

  it('refuses a pixel count that is not one', () => {
    for (const bad of [0, -24, NaN]) {
      assert.throws(() => pixelPitchMm(FF, bad), RangeError);
    }
  });
});

/* ── The rate the sky turns ────────────────────────────────────────────────── */

describe('driftRateDegPerSec', () => {
  it('takes a star on the equator round in exactly one sidereal day', () => {
    // The identity the whole module rests on, stated the other way about.
    close(driftRateDegPerSec(0) * SIDEREAL_DAY_SECONDS, 360, 1e-9);
  });

  it('is the 15.041 arcseconds a second the charts quote', () => {
    close(SIDEREAL_RATE_DEG_PER_SEC * 3600, 15.041, 0.001);
  });

  it('stops dead at the celestial pole', () => {
    close(driftRateDegPerSec(90), 0, 1e-15);
    close(driftRateDegPerSec(-90), 0, 1e-15);
  });

  it('does not care which hemisphere the declination is in', () => {
    for (const dec of [7, 29, 61, 88]) {
      close(driftRateDegPerSec(dec), driftRateDegPerSec(-dec), 1e-18, `±${dec}°`);
    }
  });

  it('slows the galactic core to 87% of the equatorial rate', () => {
    close(driftRateDegPerSec(CORE_DEC) / SIDEREAL_RATE_DEG_PER_SEC, 0.8746, 0.0005);
  });
});

/* ── Trailing ──────────────────────────────────────────────────────────────── */

const CORE_ON_24 = {
  focalLengthMm: 24,
  pixelPitchMm: A7CII_PITCH_MM,
  declinationDeg: CORE_DEC,
};

describe('trailPixels and shutterForTrailSeconds', () => {
  it('invert each other, over every lens and every sensor', () => {
    for (const focalLengthMm of [12, 24, 50, 200, 400]) {
      for (const megapixels of [12, 33, 61, 102]) {
        for (const declinationDeg of [-60, -29, 0, 45]) {
          const input = { focalLengthMm, pixelPitchMm: pixelPitchMm(FF, megapixels), declinationDeg };
          for (const seconds of [0.5, 4, 30, 240]) {
            const round = shutterForTrailSeconds(trailPixels(seconds, input), input);
            close(round, seconds, 1e-9, `${focalLengthMm}mm ${megapixels}MP δ${declinationDeg} ${seconds}s`);
          }
        }
      }
    }
  });

  it('puts the core at three and a third seconds a pixel on a 24mm a7C II', () => {
    close(shutterForTrailSeconds(1, CORE_ON_24), 3.35, 0.02);
    close(shutterForTrailSeconds(3, CORE_ON_24), 10.0, 0.1);
  });

  it('agrees with the two rules of thumb about how much they let through', () => {
    // Not used by the code, and here precisely because they are the numbers
    // everyone arrives holding. If the arithmetic disagreed with both by an
    // order of magnitude, every identity above would still pass.
    const fiveHundred = 500 / 24;
    close(trailPixels(fiveHundred, CORE_ON_24), 6.2, 0.2, '500 rule');
    const npf = (35 * 2.8 + 30 * A7CII_PITCH_MM * 1000) / 24;
    close(trailPixels(npf, CORE_ON_24), 3.1, 0.2, 'NPF rule at f/2.8');
  });

  it('halves the shutter when the lens doubles', () => {
    // Trail scales with focal length, so the time to reach a pixel scales
    // inversely. Only true because the projection is linear at these angles,
    // which is the assumption worth pinning.
    const short = shutterForTrailSeconds(1, { ...CORE_ON_24, focalLengthMm: 24 });
    const long = shutterForTrailSeconds(1, { ...CORE_ON_24, focalLengthMm: 48 });
    close(long, short / 2, short * 1e-6);
  });

  it('gives a denser sensor a shorter shutter for the same trail', () => {
    const coarse = shutterForTrailSeconds(1, { ...CORE_ON_24, pixelPitchMm: pixelPitchMm(FF, 12) });
    const fine = shutterForTrailSeconds(1, { ...CORE_ON_24, pixelPitchMm: pixelPitchMm(FF, 61) });
    assert.ok(fine < coarse);
    // And the ratio is the pitch ratio, which is what the 500 rule cannot see.
    close(coarse / fine, Math.sqrt(61 / 12), 0.01);
  });

  it('never trails at the pole, and says so rather than inventing a bound', () => {
    const polaris = { ...CORE_ON_24, declinationDeg: 90 };
    assert.equal(shutterForTrailSeconds(1, polaris), Infinity);
    assert.equal(trailPixels(3600, polaris), 0);
  });

  it('refuses a negative exposure or a trail of nothing', () => {
    assert.throws(() => trailPixels(-1, CORE_ON_24), RangeError);
    assert.throws(() => shutterForTrailSeconds(0, CORE_ON_24), RangeError);
    assert.throws(() => shutterForTrailSeconds(-3, CORE_ON_24), RangeError);
  });
});

describe('trailLimit', () => {
  it('reports both limits, in the order they happen', () => {
    const limit = trailLimit(CORE_ON_24);
    assert.ok(limit.sharpSeconds < limit.tolerantSeconds);
    assert.equal(limit.tolerancePixels, TOLERABLE_TRAIL_PX);
    close(limit.driftArcsecPerSec, 13.15, 0.05);
    close(limit.pixelPitchUm, 5.12, 0.01);
  });

  it('names the lens and the pixel it was worked out from', () => {
    // The number is only checkable if its two inputs travel with it.
    const limit = trailLimit(CORE_ON_24);
    assert.match(limit.note, /24mm/);
    assert.match(limit.note, /5\.12 µm/);
    assert.match(limit.note, /3\.3 s/);
  });

  it('says the pole has no limit instead of printing one', () => {
    const limit = trailLimit({ ...CORE_ON_24, declinationDeg: -90 });
    assert.equal(limit.sharpSeconds, Infinity);
    assert.match(limit.note, /nothing trails/);
  });

  it('takes the tolerance as an argument rather than deciding it', () => {
    const strict = trailLimit(CORE_ON_24, 1);
    assert.equal(strict.sharpSeconds, strict.tolerantSeconds);
    assert.match(strict.note, /trails 1\./);
  });
});

describe('formatShutter', () => {
  it('reads the way a shutter dial does at each scale', () => {
    assert.equal(formatShutter(0.42), '0.42 s');
    assert.equal(formatShutter(3.345), '3.3 s');
    assert.equal(formatShutter(13.7), '14 s');
    assert.equal(formatShutter(240), '4 min');
    assert.equal(formatShutter(Infinity), 'no limit');
  });
});

/* ── A region against the rectangle ────────────────────────────────────────── */

const AT = (azimuth: number, altitude: number) => ({ azimuth, altitude });

describe('frameRegion', () => {
  it('spans exactly its own diameter when the lens is pointed at it', () => {
    // On the optical axis the projection is symmetric, so the region's extremes
    // are its radius either way — which pins both the rim geometry and the
    // fraction-of-frame arithmetic against a number known in advance.
    const region = frameRegion(AT(180, 30), 7.5, { bearing: 180, tiltDeg: 30 }, WIDE);
    assert.equal(region.whollyInFrame, true);
    close(region.spanOfWidth * WIDE.horizontalDeg, 15, 0.01);
    close(region.spanOfHeight * WIDE.verticalDeg, 15, 0.01);
    assert.match(region.note, /whole bright region/);
  });

  it('holds that up near the zenith, where azimuth stops being a distance', () => {
    // The case a naive az/alt box gets wildly wrong: at 85° up, 7.5° of sky is
    // most of a right angle in azimuth. The region is still 15° across.
    const region = frameRegion(AT(0, 85), 7.5, { bearing: 0, tiltDeg: 85 }, WIDE);
    assert.equal(region.whollyInFrame, true);
    close(region.spanOfWidth * WIDE.horizontalDeg, 15, 0.05);
  });

  it('knows a centre in frame can still have its best half outside', () => {
    // Aimed 24° up at a core 45° up: the centre is comfortably in a 53°-tall
    // frame, and the top of the bulge is not.
    const region = frameRegion(AT(180, 45), 7.5, { bearing: 180, tiltDeg: 24 }, WIDE);
    assert.equal(region.centre.inFrame, true);
    assert.equal(region.whollyInFrame, false);
    assert.equal(region.partlyInFrame, true);
    assert.equal(region.overflowEdge, 'top');
    close(region.overflowDeg, 45 + 7.5 - 24 - WIDE.verticalDeg / 2, 0.2);
    assert.equal(region.shortfallDeg, 0);
    assert.match(region.note, /past the top edge/);
  });

  it('reports the near edge, not the far one, when it misses altogether', () => {
    // The distinction the first version got wrong: "overflows the top by 4°"
    // and "starts 4° above the top" are opposite situations, and the furthest
    // extreme only answers the first.
    const region = frameRegion(AT(180, 70), 7.5, { bearing: 180, tiltDeg: 0 }, WIDE);
    assert.equal(region.partlyInFrame, false);
    assert.equal(region.shortfallEdge, 'top');
    // Nearest part of the region is at 62.5°, the top edge at 26.5°.
    close(region.shortfallDeg, 70 - 7.5 - WIDE.verticalDeg / 2, 0.5);
    assert.ok(region.overflowDeg > region.shortfallDeg, 'the far extreme must be further out');
    assert.match(region.note, /None of the bright region/);
  });

  it('swallows the frame whole on a long lens', () => {
    const region = frameRegion(AT(180, 30), 7.5, { bearing: 180, tiltDeg: 30 }, LONG);
    assert.equal(region.centre.inFrame, true);
    assert.equal(region.whollyInFrame, false);
    assert.equal(region.partlyInFrame, true);
    assert.ok(region.spanOfWidth > 1, 'the region should be wider than the frame');
    assert.ok(region.spanOfHeight > 1);
  });

  it('takes up more of the frame as the lens gets longer', () => {
    let previous = 0;
    for (const focal of [14, 24, 50, 135]) {
      const fov = fieldOfView(FF, focal);
      const region = frameRegion(AT(180, 30), 7.5, { bearing: 180, tiltDeg: 30 }, fov);
      assert.ok(region.spanOfWidth > previous, `${focal}mm did not fill more`);
      previous = region.spanOfWidth;
    }
  });

  it('refuses to answer for a region straddling the image plane', () => {
    // 90° off the aim with a 7.5° radius: part of it is behind the camera, where
    // the projection sends points to infinity. Better to say so.
    const region = frameRegion(AT(270, 0), 7.5, { bearing: 180, tiltDeg: 0 }, WIDE);
    assert.equal(region.whollyInFrame, false);
    assert.match(region.note, /not a question this model can answer/);
  });

  it('refuses a region with no size', () => {
    for (const bad of [0, -5, NaN]) {
      assert.throws(() => frameRegion(AT(180, 30), bad, { bearing: 180, tiltDeg: 30 }, WIDE), RangeError);
    }
  });
});

describe('frameTheCore', () => {
  it('is frameRegion at the core\'s own stated size', () => {
    const aim = { bearing: 150, tiltDeg: 20 };
    const target = AT(150, 20);
    assert.deepEqual(
      frameTheCore(target, aim, WIDE),
      frameRegion(target, CORE_SPAN_DEG / 2, aim, WIDE),
    );
  });

  it('does not fit a 15° core into a 200mm frame, and does into a 24mm one', () => {
    const aim = { bearing: 150, tiltDeg: 20 };
    assert.equal(frameTheCore(AT(150, 20), aim, WIDE).whollyInFrame, true);
    assert.equal(frameTheCore(AT(150, 20), aim, LONG).whollyInFrame, false);
  });
});

/* ── The window it is in the picture for ───────────────────────────────────── */

describe('inFrameWindows', () => {
  const START = new Date('2026-08-08T21:00:00Z');
  const hoursLater = (h: number) => new Date(+START + h * 3_600_000);

  /** A target drifting west along the horizon at the sidereal rate. */
  const drifting = (at: Date) =>
    AT(180 + ((+at - +START) / 3_600_000) * 15, 0);

  it('opens and closes where the target crosses the frame edge', () => {
    const aim = { bearing: 210, tiltDeg: 0 };
    const windows = inFrameWindows(START, hoursLater(6), drifting, aim, LONG, 5);
    assert.equal(windows.length, 1);
    // Enters at 30° − half the frame, leaves at 30° + half, at 15°/hour.
    const halfH = LONG.horizontalDeg / 2;
    close((+windows[0].from - +START) / 3_600_000, (30 - halfH) / 15, 0.01);
    close((+windows[0].to - +START) / 3_600_000, (30 + halfH) / 15, 0.01);
  });

  it('is found to the second, not to the sampling step', () => {
    // The reason this borrows `intervalsWhere` instead of scanning a track: a
    // five-minute step and a one-minute step must give the same answer.
    const aim = { bearing: 210, tiltDeg: 0 };
    const coarse = inFrameWindows(START, hoursLater(6), drifting, aim, LONG, 5);
    const fine = inFrameWindows(START, hoursLater(6), drifting, aim, LONG, 1);
    close(+coarse[0].from, +fine[0].from, 2000);
    close(+coarse[0].to, +fine[0].to, 2000);
  });

  it('gives a wide lens a longer window than a long one', () => {
    const aim = { bearing: 210, tiltDeg: 0 };
    const span = (fov: Fov) => {
      const [window] = inFrameWindows(START, hoursLater(8), drifting, aim, fov, 5);
      return +window.to - +window.from;
    };
    assert.ok(span(WIDE) > span(LONG) * 5);
  });

  it('returns nothing for a target that never comes into the picture', () => {
    const aim = { bearing: 0, tiltDeg: 70 };
    assert.deepEqual(inFrameWindows(START, hoursLater(6), drifting, aim, LONG, 5), []);
  });
});
