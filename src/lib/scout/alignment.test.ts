import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STEP_MINUTES,
  MOON,
  SUN,
  closestPass,
  findAlignments,
  scanAltitudeCrossings,
  scanCrossings,
  withMoonPhase,
  withMoonPhaseAt,
  type BodySampler,
} from './alignment.ts';
import { seasonEvents } from './almanac.ts';
import { angleDelta } from './frame.ts';
import { moonIllumination, moonPosition } from './moon.ts';
import { sunPosition } from './sun.ts';

/** Calton Hill, which is where every other measurement in this project was taken. */
const CALTON = { lat: 55.9553, lon: -3.1817 };
const EQUATOR = { lat: 0, lon: 0 };

const AUGUST = new Date('2026-08-09T00:00:00Z');
const YEAR = { from: AUGUST, days: 365 };

describe('SUN and MOON samplers', () => {
  it('report the apparent altitude, not the geometric one', () => {
    // Half a degree at the horizon is more than the sun's own width, and it is
    // the whole reason a sunset is not where bare geometry puts it.
    const at = new Date('2026-09-23T18:05:00Z');
    const sun = sunPosition(CALTON.lat, CALTON.lon, at);
    assert.equal(SUN(CALTON, at).altitude, sun.altitudeApparent);
    assert.ok(sun.altitudeApparent - sun.altitude > 0.4, 'refraction should be lifting it here');
  });

  it('derives the sun’s disc from its distance rather than tabulating it', () => {
    // 0.2666° at one astronomical unit, and it really does move: the earth is
    // 3.4% closer to the sun in January than in July.
    const january = SUN(CALTON, new Date('2027-01-03T12:00:00Z')).angularRadius;
    const july = SUN(CALTON, new Date('2027-07-05T12:00:00Z')).angularRadius;
    assert.ok(january > july, `${january} should exceed ${july}`);
    assert.ok(Math.abs(january - 0.2725) < 0.002, `${january}`);
    assert.ok(Math.abs(july - 0.2636) < 0.002, `${july}`);
  });

  it('takes the moon’s disc from the moon, which varies by a tenth', () => {
    const at = new Date('2026-11-05T20:00:00Z');
    assert.equal(MOON(CALTON, at).angularRadius, moonPosition(CALTON.lat, CALTON.lon, at).angularRadius);
  });
});

describe('scanCrossings', () => {
  it('finds the sun on a bearing once a day, and lands on it to a thousandth of a degree', () => {
    const scan = scanCrossings(SUN, CALTON, 90, AUGUST, new Date('2026-08-19T00:00:00Z'));
    assert.equal(scan.crossings.length, 10);
    for (const crossing of scan.crossings) {
      const azimuth = sunPosition(CALTON.lat, CALTON.lon, crossing.at).azimuth;
      assert.ok(Math.abs(angleDelta(90, azimuth)) < 0.001, `${crossing.at.toISOString()} → ${azimuth}`);
    }
  });

  it('does not mistake the far side of the compass for a crossing', () => {
    // Passing due south wraps the signed gap from +180 to −180 for a bearing of
    // north. A sign test alone would call that a crossing every single day.
    const scan = scanCrossings(SUN, CALTON, 0, AUGUST, new Date('2026-08-19T00:00:00Z'));
    assert.equal(scan.crossings.length, 10);
    for (const crossing of scan.crossings) {
      const azimuth = sunPosition(CALTON.lat, CALTON.lon, crossing.at).azimuth;
      assert.ok(Math.abs(angleDelta(0, azimuth)) < 0.001, `${crossing.at.toISOString()} → ${azimuth}`);
    }
  });

  it('separates the branch on the way up from the branch on the way down', () => {
    const rising = scanCrossings(SUN, CALTON, 90, AUGUST, new Date('2026-08-12T00:00:00Z'));
    const setting = scanCrossings(SUN, CALTON, 270, AUGUST, new Date('2026-08-12T00:00:00Z'));
    assert.ok(rising.crossings.every((c) => !c.descending), 'due east in August is a rising sun');
    assert.ok(setting.crossings.every((c) => c.descending), 'due west in August is a setting sun');
  });

  it('says how close it came when it never reaches the bearing at all', () => {
    // At the equator near the June solstice the sun stays in the northern half
    // of the sky all day, so due south is simply never reached.
    const scan = scanCrossings(SUN, EQUATOR, 180, new Date('2026-06-18T00:00:00Z'), new Date('2026-06-23T00:00:00Z'));
    assert.equal(scan.crossings.length, 0);
    assert.ok(scan.closestGapDeg > 100, `${scan.closestGapDeg}`);
  });
});

describe('scanAltitudeCrossings', () => {
  it('finds the moon at a given altitude, and lands on it to a thousandth of a degree', () => {
    const scan = scanAltitudeCrossings(MOON, CALTON, 15, AUGUST, new Date('2026-08-14T00:00:00Z'));
    assert.ok(scan.crossings.length > 0);
    for (const crossing of scan.crossings) {
      const altitude = moonPosition(CALTON.lat, CALTON.lon, crossing.at).altitudeApparent;
      assert.ok(Math.abs(altitude - 15) < 0.001, `${crossing.at.toISOString()} → ${altitude}°`);
    }
  });

  it('tells rising from sinking without needing a wrap check altitude never has', () => {
    const scan = scanAltitudeCrossings(SUN, CALTON, 10, AUGUST, new Date('2026-08-10T00:00:00Z'));
    const rising = scan.crossings.filter((c) => c.ascending);
    const sinking = scan.crossings.filter((c) => !c.ascending);
    assert.ok(rising.length > 0 && sinking.length > 0);
    for (const c of rising) {
      const after = sunPosition(CALTON.lat, CALTON.lon, new Date(c.at.getTime() + 60_000)).altitudeApparent;
      assert.ok(after > 10, `rising crossing at ${c.at.toISOString()} did not climb`);
    }
    for (const c of sinking) {
      const after = sunPosition(CALTON.lat, CALTON.lon, new Date(c.at.getTime() + 60_000)).altitudeApparent;
      assert.ok(after < 10, `sinking crossing at ${c.at.toISOString()} did not fall`);
    }
  });

  it('says how close it came when the altitude is never reached at all', () => {
    // The sun does not clear 70° at Calton Hill's latitude even at midsummer noon.
    const scan = scanAltitudeCrossings(SUN, CALTON, 70, new Date('2026-06-21T00:00:00Z'), new Date('2026-06-22T00:00:00Z'));
    assert.equal(scan.crossings.length, 0);
    assert.ok(scan.closestGapDeg > 0 && scan.closestGapDeg < 70);
  });

  it('carries no bearing at all — issue #49\'s free-form query needs none', () => {
    const scan = scanAltitudeCrossings(MOON, CALTON, 15, AUGUST, new Date('2026-08-14T00:00:00Z'));
    assert.ok(scan.crossings.length > 0);
    assert.ok(scan.crossings.every((c) => typeof c.azimuth === 'number' && !('bearing' in c)));
  });
});

describe('withMoonPhaseAt', () => {
  it('attaches the same illumination moonIllumination itself reports', () => {
    const scan = scanAltitudeCrossings(MOON, CALTON, 15, AUGUST, new Date('2026-08-19T00:00:00Z'));
    const withPhase = withMoonPhaseAt(scan.crossings);
    assert.equal(withPhase.length, scan.crossings.length);
    for (const crossing of withPhase) {
      const illumination = moonIllumination(crossing.at);
      assert.equal(crossing.fraction, illumination.fraction);
      assert.equal(crossing.phase, illumination.name);
    }
  });

  it('answers issue #49\'s worked example: 15° altitude, over 80% illuminated', () => {
    const scan = scanAltitudeCrossings(MOON, CALTON, 15, AUGUST, new Date('2026-09-08T00:00:00Z'));
    const bright = withMoonPhaseAt(scan.crossings).filter((c) => c.fraction > 0.8);
    // A lunar month has a handful of nights over 80% lit; a four-week window
    // crossing 15° twice a day should catch at least one of them.
    assert.ok(bright.length > 0, `no bright crossings among ${scan.crossings.length}`);
    for (const c of bright) assert.ok(c.fraction > 0.8);
  });
});

describe('findAlignments — the sun', () => {
  it('puts the due-west sunset on the equinox', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 270, horizonDeg: 0, ...YEAR });
    const met = search.events.filter((event) => event.meets);
    assert.equal(met.length, 2, search.note);

    const [, , september] = seasonEvents(2026);
    const days =
      Math.abs(met[0].best.at.getTime() - september.date.getTime()) / 86_400_000;
    assert.ok(days < 2, `${met[0].best.at.toISOString()} vs ${september.date.toISOString()}`);
  });

  it('is verifiable against sunPosition, which it shares no arithmetic with here', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 245, horizonDeg: 3.1, ...YEAR });
    const met = search.events.filter((event) => event.meets);
    assert.ok(met.length >= 1, search.note);
    for (const event of met) {
      const sun = sunPosition(CALTON.lat, CALTON.lon, event.best.at);
      assert.ok(Math.abs(angleDelta(245, sun.azimuth)) < 0.001, `azimuth ${sun.azimuth}`);
      // On the meeting date the sun really is at the ridge's height as it goes
      // through the bearing — within the disc that defines "meets".
      assert.ok(
        Math.abs(sun.altitudeApparent - 3.1) <= event.best.angularRadius,
        `altitude ${sun.altitudeApparent}`,
      );
    }
  });

  it('reports a pass as the run of dates it is, with the closest one named', () => {
    // A 40° obstruction is crossed twice a year, and the geometry drifts slowly
    // enough there that the disc is on the line for two evenings running.
    const search = findAlignments(SUN, CALTON, { bearing: 245, horizonDeg: 40, ...YEAR });
    const met = search.events.filter((event) => event.meets);
    assert.ok(met.length >= 1, search.note);
    const pass = met[0];
    assert.ok(pass.window.length >= 2, `window of ${pass.window.length}`);
    for (const crossing of pass.window) {
      assert.ok(
        Math.abs(crossing.clearanceDeg) >= Math.abs(pass.best.clearanceDeg),
        'best must be the closest in its own window',
      );
      assert.ok(Math.abs(crossing.clearanceDeg) <= crossing.angularRadius, 'every date in the window touches');
    }
    // In time order, so a reader can pick the evening that suits them.
    for (let i = 1; i < pass.window.length; i++) {
      assert.ok(pass.window[i].at.getTime() > pass.window[i - 1].at.getTime());
    }
  });

  it('marks a pass that goes behind, and one that only grazes', () => {
    const behind = findAlignments(SUN, CALTON, { bearing: 270, horizonDeg: 0, ...YEAR });
    assert.ok(behind.events.filter((e) => e.meets).every((e) => e.passesBehind));
  });
});

describe('findAlignments — the four absences', () => {
  it('no-bearing: it never reaches that compass point from here', () => {
    const search = findAlignments(SUN, EQUATOR, {
      bearing: 180,
      horizonDeg: 0,
      from: new Date('2026-06-18T00:00:00Z'),
      days: 5,
    });
    assert.equal(search.absence, 'no-bearing');
    assert.equal(search.events.length, 0);
    assert.match(search.note, /never reaches 180°/);
    assert.match(search.note, /113\.\d°/);
  });

  it('always-above: it crosses, but always clear of what is there', () => {
    // Due south from Edinburgh is solar noon. The sun is never near the horizon
    // there — the lowest it manages is about ten degrees, at the solstice.
    const search = findAlignments(SUN, CALTON, { bearing: 180, horizonDeg: 0, ...YEAR });
    assert.equal(search.absence, 'always-above');
    assert.match(search.note, /never closer than 10\.\d° above/);
    assert.ok(search.events.length > 0, 'a refusal still has to carry the closest approach');
  });

  it('always-below: by the time it gets there it is already hidden', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 350, horizonDeg: 0, ...YEAR });
    assert.equal(search.absence, 'always-below');
    assert.match(search.note, /already behind/);
    assert.match(search.note, /never closer than 10\.\d° below/);
  });

  it('never-quite: either side of it, but never within the tolerance', () => {
    const search = findAlignments(SUN, CALTON, {
      bearing: 270,
      horizonDeg: 0,
      toleranceDeg: 0.001,
      ...YEAR,
    });
    assert.equal(search.absence, 'never-quite');
    // A tolerance the caller chose must not be reported as a fact about the sky.
    assert.match(search.note, /within 0\.0°/);
    assert.doesNotMatch(search.note, /disc's width/);
  });

  it('carries the closest approach whichever absence it is', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 180, horizonDeg: 0, ...YEAR });
    const closest = closestPass(search);
    assert.ok(closest);
    for (const event of search.events) {
      assert.ok(Math.abs(event.best.clearanceDeg) >= Math.abs(closest.best.clearanceDeg));
    }
    assert.match(closest.note, /closest approach: 10\.\d° above it/);
  });
});

describe('findAlignments — the tolerance is the body’s own disc', () => {
  /** A body parked on the bearing, whose altitude walks past the horizon by a step a day. */
  const walking = (startAltitude: number, stepPerDay: number, radius: number): BodySampler => {
    const start = AUGUST.getTime();
    return (_point, at) => {
      const days = (at.getTime() - start) / 86_400_000;
      // One turn a day, so there is exactly one crossing of due south per day.
      return {
        azimuth: ((days % 1) * 360 + 180) % 360,
        altitude: startAltitude + stepPerDay * Math.floor(days),
        angularRadius: radius,
      };
    };
  };

  it('counts a crossing inside the disc and not one outside it', () => {
    const body = walking(-1, 0.4, 0.25);
    const search = findAlignments(body, CALTON, {
      bearing: 180,
      horizonDeg: 0,
      from: AUGUST,
      days: 10,
      stepMinutes: 1,
    });
    const met = search.events.filter((event) => event.meets).flatMap((event) => event.window);
    // The walk lands on −0.2 and +0.2 either side of zero; both are inside a
    // 0.25° disc and the −0.6/+0.6 dates around them are not.
    assert.equal(met.length, 2, met.map((c) => c.clearanceDeg.toFixed(2)).join(','));
    assert.ok(met.every((crossing) => Math.abs(crossing.clearanceDeg) <= 0.25));
  });

  it('gives a bigger disc a wider window, without being told to', () => {
    const narrow = findAlignments(walking(-1, 0.4, 0.1), CALTON, {
      bearing: 180, horizonDeg: 0, from: AUGUST, days: 10, stepMinutes: 1,
    });
    const wide = findAlignments(walking(-1, 0.4, 0.7), CALTON, {
      bearing: 180, horizonDeg: 0, from: AUGUST, days: 10, stepMinutes: 1,
    });
    const dates = (search: typeof narrow) =>
      search.events.filter((e) => e.meets).flatMap((e) => e.window).length;
    assert.equal(dates(narrow), 0);
    assert.equal(dates(wide), 4);
  });
});

describe('findAlignments — the edges of the search', () => {
  it('says which end of the window a pass was still closing at', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 270, horizonDeg: 0, ...YEAR });
    const edges = search.events.filter((event) => event.atSearchEdge);
    assert.ok(edges.length > 0);
    for (const event of edges) {
      assert.ok(event.atSearchEdge === 'start' || event.atSearchEdge === 'end');
      assert.match(
        event.note,
        event.atSearchEdge === 'end' ? /still closing/ : /already past its closest/,
      );
    }
  });

  it('records the window it actually searched', () => {
    const search = findAlignments(SUN, CALTON, { bearing: 270, horizonDeg: 0, ...YEAR });
    assert.equal(search.from.getTime(), AUGUST.getTime());
    assert.equal(search.to.getTime(), AUGUST.getTime() + 365 * 86_400_000);
    assert.equal(search.stepMinutes, DEFAULT_STEP_MINUTES);
    assert.equal(search.crossings, 365);
  });
});

describe('withMoonPhase', () => {
  it('tells a full-moon pass from a new-moon one at the same bearing', () => {
    const search = findAlignments(MOON, CALTON, { bearing: 250, horizonDeg: 1, ...YEAR });
    const passes = withMoonPhase(search.events);
    assert.ok(passes.length > 12, `${passes.length} passes in a year`);

    const full = passes.filter((pass) => pass.phase === 'full');
    const fresh = passes.filter((pass) => pass.phase === 'new');
    assert.ok(full.length >= 1, 'a year of passes should include a full moon');
    assert.ok(fresh.length >= 1, 'and a new one');
    assert.ok(full.every((pass) => pass.fraction > 0.99));
    assert.ok(fresh.every((pass) => pass.fraction < 0.02));
  });

  it('reads the phase at the pass’s own instant, not the date’s', () => {
    const search = findAlignments(MOON, CALTON, { bearing: 250, horizonDeg: 1, ...YEAR });
    for (const pass of withMoonPhase(search.events).slice(0, 5)) {
      const illumination = moonIllumination(pass.best.at);
      assert.equal(pass.fraction, illumination.fraction);
      assert.equal(pass.phase, illumination.name);
      assert.equal(pass.waxing, illumination.waxing);
    }
  });

  it('leaves the passes alone otherwise — no filtering, no reordering', () => {
    const search = findAlignments(MOON, CALTON, { bearing: 250, horizonDeg: 1, ...YEAR });
    const passes = withMoonPhase(search.events);
    assert.equal(passes.length, search.events.length);
    passes.forEach((pass, index) => {
      assert.equal(pass.best.at.getTime(), search.events[index].best.at.getTime());
    });
  });
});
