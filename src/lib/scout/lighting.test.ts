/**
 * Tests for the lighting verdict.
 *
 * The property that matters most here is not any single label — the band edges
 * are conventions and could be argued — but that the module **refuses in the
 * right order and never invents an aim**. Most of these tests are about the
 * absences, because those are the cases where a wrong answer would look exactly
 * like a right one on screen.
 *
 * The geometry is checked against a fact with no arithmetic in common with the
 * code: at any instant, aiming *at* the sun and aiming *away* from it are 180°
 * apart and must land in opposite bands.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACK_LIT_MAX_DEG,
  FRONT_LIT_MIN_DEG,
  RIM_LIT_MAX_ALTITUDE_DEG,
  compareSpots,
  describeLighting,
  litMinutesAhead,
  type RankableSpot,
} from './lighting.ts';

/** A lit spot under a high sun, so only the aim varies. */
const at = (aimBearing: number | undefined, sunAzimuth: number, sunAltitude = 40) =>
  describeLighting({ aimBearing, sunAzimuth, sunAltitude, lit: true });

/* ── The bands ─────────────────────────────────────────────────────────────── */

describe('which way the light falls', () => {
  it('calls it back-lit when the camera points at the sun', () => {
    const light = at(180, 180);
    assert.equal(light.direction, 'back');
    assert.equal(light.absence, null);
    assert.equal(light.offsetDeg, 0);
  });

  it('calls it front-lit when the sun is behind the photographer', () => {
    const light = at(0, 180);
    assert.equal(light.direction, 'front');
    assert.equal(Math.abs(light.offsetDeg!), 180);
  });

  it('calls it side-lit at a right angle, and says which side', () => {
    const right = at(0, 90);
    assert.equal(right.direction, 'side');
    assert.equal(right.side, 'right');
    assert.match(right.note, /side-lit from the right/);

    const left = at(0, 270);
    assert.equal(left.direction, 'side');
    assert.equal(left.side, 'left');
    assert.match(left.note, /side-lit from the left/);
  });

  it('puts the two opposite aims in opposite bands, at every azimuth', () => {
    // No arithmetic in common with the implementation: whatever the sun is
    // doing, pointing at it and pointing away from it cannot both be the same
    // kind of light.
    for (let azimuth = 0; azimuth < 360; azimuth += 7) {
      const towards = at(azimuth, azimuth).direction;
      const away = at((azimuth + 180) % 360, azimuth).direction;
      assert.equal(towards, 'back', `aiming at the sun from ${azimuth}°`);
      assert.equal(away, 'front', `aiming away from the sun at ${azimuth}°`);
    }
  });

  it('is symmetric about the aim — mirroring the sun mirrors only the side', () => {
    for (let off = 5; off < 180; off += 5) {
      const right = at(0, off);
      const left = at(0, 360 - off);
      assert.equal(left.direction, right.direction, `${off}° either side`);
      assert.equal(right.side, 'right');
      assert.equal(left.side, 'left');
      assert.equal(Math.abs(left.offsetDeg!), Math.abs(right.offsetDeg!));
    }
  });

  it('holds the band edges where they are documented', () => {
    assert.equal(at(0, BACK_LIT_MAX_DEG).direction, 'back');
    assert.equal(at(0, BACK_LIT_MAX_DEG + 1).direction, 'side');
    assert.equal(at(0, FRONT_LIT_MIN_DEG - 1).direction, 'side');
    assert.equal(at(0, FRONT_LIT_MIN_DEG).direction, 'front');
  });

  it('wraps: an aim of 350° and a sun at 10° are 20° apart, not 340°', () => {
    const light = at(350, 10);
    assert.equal(light.direction, 'back');
    assert.equal(light.offsetDeg, 20);
    assert.equal(light.side, 'right');
  });
});

/* ── Rim light ─────────────────────────────────────────────────────────────── */

describe('rim light', () => {
  it('is back light under a low sun, and only then', () => {
    assert.equal(at(0, 10, RIM_LIT_MAX_ALTITUDE_DEG - 1).direction, 'rim');
    assert.equal(at(0, 10, RIM_LIT_MAX_ALTITUDE_DEG).direction, 'rim');
    assert.equal(at(0, 10, RIM_LIT_MAX_ALTITUDE_DEG + 1).direction, 'back');
  });

  it('is never claimed for side or front light, however low the sun', () => {
    assert.equal(at(0, 90, 1).direction, 'side');
    assert.equal(at(0, 180, 1).direction, 'front');
  });

  it('prints the altitude, because that is what separates it from back light', () => {
    assert.match(at(0, 8, 6).note, /rim-lit · sun 8° off aim, 6° up/);
  });
});

/* ── The refusals ──────────────────────────────────────────────────────────── */

describe('when there is no direction to give', () => {
  it('refuses when the sun is down, even with a perfect aim', () => {
    const light = describeLighting({ aimBearing: 0, sunAzimuth: 180, sunAltitude: -3, lit: false });
    assert.equal(light.direction, null);
    assert.equal(light.absence, 'sun-down');
    assert.equal(light.note, 'the sun is down');
  });

  it('treats a sun exactly on the horizon as down — there is no beam at 0°', () => {
    assert.equal(
      describeLighting({ aimBearing: 0, sunAzimuth: 180, sunAltitude: 0, lit: true }).absence,
      'sun-down',
    );
  });

  it('refuses when the spot is in shade under a sun that is up', () => {
    const light = describeLighting({ aimBearing: 0, sunAzimuth: 180, sunAltitude: 30, lit: false });
    assert.equal(light.direction, null);
    assert.equal(light.absence, 'in-shadow');
  });

  it('refuses when the aim was never recorded, which is every Commons photograph', () => {
    const light = describeLighting({ sunAzimuth: 180, sunAltitude: 30, lit: true });
    assert.equal(light.direction, null);
    assert.equal(light.absence, 'aim-unknown');
    assert.equal(light.offsetDeg, null);
    assert.equal(light.side, null);
  });

  it('never invents an aim from a NaN or an infinity', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const light = describeLighting({
        aimBearing: bad,
        sunAzimuth: 180,
        sunAltitude: 30,
        lit: true,
      });
      assert.equal(light.absence, 'aim-unknown', `bearing ${bad}`);
      assert.equal(light.offsetDeg, null);
    }
  });

  it('reports the sun being down before it reports the aim missing', () => {
    // The order is the point: "the sun is down" is the useful sentence at
    // midnight, and "aim unknown" would be technically true and useless.
    const light = describeLighting({ sunAzimuth: 180, sunAltitude: -10, lit: false });
    assert.equal(light.absence, 'sun-down');
  });

  it('still gives the offset for a shaded spot whose aim is known', () => {
    // The geometry is true whether or not the light arrives, and "the sun will
    // be 20° off your aim" is worth knowing while you wait for it.
    const light = describeLighting({ aimBearing: 0, sunAzimuth: 20, sunAltitude: 30, lit: false });
    assert.equal(light.absence, 'in-shadow');
    assert.equal(light.offsetDeg, 20);
    assert.equal(light.side, 'right');
  });

  it('sets exactly one of direction and absence, in every case', () => {
    const cases = [
      { aimBearing: 0, sunAzimuth: 0, sunAltitude: 40, lit: true },
      { aimBearing: 0, sunAzimuth: 90, sunAltitude: 40, lit: true },
      { aimBearing: 0, sunAzimuth: 5, sunAltitude: 3, lit: true },
      { aimBearing: 0, sunAzimuth: 180, sunAltitude: 40, lit: false },
      { sunAzimuth: 180, sunAltitude: 40, lit: true },
      { sunAzimuth: 180, sunAltitude: -5, lit: false },
    ];
    for (const input of cases) {
      const light = describeLighting(input);
      assert.equal(
        (light.direction === null) !== (light.absence === null),
        true,
        JSON.stringify(input),
      );
      assert.ok(light.note.length > 0);
    }
  });
});

/* ── Light still ahead ─────────────────────────────────────────────────────── */

describe('how much light is left', () => {
  const day = [
    { lit: false, startMinute: 0, endMinute: 400 },
    { lit: true, startMinute: 400, endMinute: 600 },
    { lit: false, startMinute: 600, endMinute: 700 },
    { lit: true, startMinute: 700, endMinute: 1200 },
    { lit: false, startMinute: 1200, endMinute: 1440 },
  ];

  it('adds up every lit window still to come', () => {
    assert.equal(litMinutesAhead(day, 0), 700);
  });

  it('counts only the remainder of a window it is standing in', () => {
    assert.equal(litMinutesAhead(day, 500), 100 + 500);
  });

  it('is zero after the last light', () => {
    assert.equal(litMinutesAhead(day, 1200), 0);
    assert.equal(litMinutesAhead(day, 1439), 0);
  });

  it('counts a window that starts on this very minute in full', () => {
    assert.equal(litMinutesAhead(day, 700), 500);
  });

  it('is zero for a day with no light at all', () => {
    assert.equal(litMinutesAhead([{ lit: false, startMinute: 0, endMinute: 1440 }], 0), 0);
    assert.equal(litMinutesAhead([], 0), 0);
  });
});

/* ── The order ─────────────────────────────────────────────────────────────── */

describe('ordering spots for "best right now"', () => {
  const spot = (over: Partial<RankableSpot>): RankableSpot => ({
    lit: true,
    buildingsKnown: true,
    litMinutesAhead: 60,
    count: 5,
    distanceM: 500,
    ...over,
  });

  it('puts a lit spot above a shaded one, whatever else is true of it', () => {
    const shaded = spot({ lit: false, litMinutesAhead: 600, count: 99, distanceM: 1 });
    const lit = spot({ lit: true, litMinutesAhead: 1, count: 1, distanceM: 9999 });
    assert.ok(compareSpots(lit, shaded) < 0);
    assert.ok(compareSpots(shaded, lit) > 0);
  });

  it('does not let a spot outrank a better-known one by being unexamined', () => {
    // The bias this criterion exists for. A spot with no buildings loaded has
    // nothing to shade it, so it always reports more light — and on the real
    // page that floated every least-known spot to the top of the list.
    const unknown = spot({ buildingsKnown: false, litMinutesAhead: 700 });
    const known = spot({ buildingsKnown: true, litMinutesAhead: 60 });
    assert.ok(compareSpots(known, unknown) < 0);
  });

  it('still ranks a lit unknown spot above a shaded known one', () => {
    // Confidence outranks the light it inflates, but not the light itself:
    // being in shade is a finding, and not knowing is not worse than that.
    const litUnknown = spot({ lit: true, buildingsKnown: false });
    const shadedKnown = spot({ lit: false, buildingsKnown: true });
    assert.ok(compareSpots(litUnknown, shadedKnown) < 0);
  });

  it('then prefers the spot with more light still to come', () => {
    assert.ok(compareSpots(spot({ litMinutesAhead: 200 }), spot({ litMinutesAhead: 30 })) < 0);
  });

  it('then prefers the more photographed, then the nearer', () => {
    assert.ok(compareSpots(spot({ count: 20 }), spot({ count: 3 })) < 0);
    assert.ok(compareSpots(spot({ distanceM: 100 }), spot({ distanceM: 900 })) < 0);
  });

  it('is a total order — sorting is stable and reversible', () => {
    const spots = [
      spot({ lit: false, litMinutesAhead: 0, count: 1, distanceM: 100 }),
      spot({ lit: true, litMinutesAhead: 10, count: 1, distanceM: 100 }),
      spot({ lit: true, litMinutesAhead: 10, count: 9, distanceM: 100 }),
      spot({ lit: true, litMinutesAhead: 90, count: 1, distanceM: 100 }),
      spot({ lit: true, buildingsKnown: false, litMinutesAhead: 900, count: 9, distanceM: 10 }),
    ];
    const forwards = [...spots].sort(compareSpots);
    const backwards = [...spots].reverse().sort(compareSpots);
    assert.deepEqual(forwards, backwards);
    assert.equal(forwards[0].litMinutesAhead, 90);
    // The unexamined spot has the most light of all and still does not lead.
    assert.equal(forwards[3].buildingsKnown, false);
    assert.equal(forwards[4].lit, false);
  });

  it('returns 0 only for spots that agree on every criterion', () => {
    assert.equal(compareSpots(spot({}), spot({})), 0);
    assert.notEqual(compareSpots(spot({}), spot({ distanceM: 501 })), 0);
  });
});
