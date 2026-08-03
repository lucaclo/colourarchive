import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSkyline,
  isSunlit,
  lightWindows,
  mergeHorizon,
  nextChange,
  obstructionAt,
  summariseLight,
  type Ring,
  type SkylineBuilding,
} from './skyline.ts';
import { destination, type LatLon } from './geo.ts';
import { type SunSample } from './sun.ts';

const ORIGIN: LatLon = { lat: 51.5, lon: -0.12 };

/**
 * A square building `sizeM` on a side, centred `distanceM` away on `bearing`.
 * Built with the real geodesy so the test exercises the same projection the
 * caller will feed it.
 */
function blockAt(distanceM: number, bearing: number, heightM: number, sizeM = 20): SkylineBuilding {
  const centre = destination(ORIGIN, bearing, distanceM);
  const half = sizeM / 2;
  const corners: Ring = [];
  for (const [db, dd] of [
    [45, 1],
    [135, 1],
    [225, 1],
    [315, 1],
  ] as const) {
    const c = destination(centre, db, half * Math.SQRT2 * dd);
    corners.push([c.lon, c.lat]);
  }
  return { ring: corners, height: heightM };
}

/** A day track stub — only azimuth and altitude are ever read. */
const track = (pairs: Array<[number, number]>): SunSample[] =>
  pairs.map(([azimuth, altitude], i) => ({
    date: new Date(Date.UTC(2026, 6, 1, 0, i)),
    azimuth,
    altitude,
    phase: altitude > 0 ? 'day' : 'night',
  })) as SunSample[];

describe('buildSkyline', () => {
  it('puts a wall at the bearing it actually stands on', () => {
    // 20m tall, 20m away, due east. atan(20/20) is 45°, less a little because
    // the near face is 10m nearer than the centre.
    const skyline = buildSkyline(ORIGIN, [blockAt(20, 90, 20)]);
    assert.ok(obstructionAt(skyline, 90) > 50, `${obstructionAt(skyline, 90)}`);
    assert.ok(obstructionAt(skyline, 90) < 70, `${obstructionAt(skyline, 90)}`);
    // And nothing at all behind it.
    assert.equal(obstructionAt(skyline, 270), 0);
    assert.equal(obstructionAt(skyline, 0), 0);
  });

  it('falls off with distance the way an angle should', () => {
    const near = buildSkyline(ORIGIN, [blockAt(50, 180, 30)]);
    const far = buildSkyline(ORIGIN, [blockAt(500, 180, 30)]);
    assert.ok(obstructionAt(near, 180) > obstructionAt(far, 180));
    // 30m at ~500m is about 3.4°.
    assert.ok(Math.abs(obstructionAt(far, 180) - 3.4) < 1.2, `${obstructionAt(far, 180)}`);
  });

  it('rises with height', () => {
    const low = buildSkyline(ORIGIN, [blockAt(100, 45, 10)]);
    const high = buildSkyline(ORIGIN, [blockAt(100, 45, 60)]);
    assert.ok(obstructionAt(high, 45) > obstructionAt(low, 45) * 4);
  });

  it('covers the whole arc a nearby building subtends, not just its corners', () => {
    // A 40m block 30m to the south covers roughly ±34° of bearing. Every bearing
    // across it must be blocked — an early version filled corners only and left
    // gaps of daylight straight through the middle of buildings.
    const skyline = buildSkyline(ORIGIN, [blockAt(30, 180, 40, 40)]);
    for (let bearing = 165; bearing <= 195; bearing += 1) {
      assert.ok(obstructionAt(skyline, bearing) > 20, `${bearing}: ${obstructionAt(skyline, bearing)}`);
    }
  });

  it('keeps the tallest obstruction when buildings overlap in bearing', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(100, 90, 10), blockAt(200, 90, 90)]);
    // The far tower wins on angle despite being further away.
    assert.ok(obstructionAt(skyline, 90) > 20, `${obstructionAt(skyline, 90)}`);
  });

  it('ignores buildings beyond the search radius', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(3000, 90, 200)], { radiusM: 800 });
    assert.equal(obstructionAt(skyline, 90), 0);
    assert.equal(skyline.considered, 0);
  });

  it('ignores buildings with no height rather than guessing one', () => {
    const skyline = buildSkyline(ORIGIN, [{ ...blockAt(40, 90, 0), height: 0 }]);
    assert.equal(skyline.considered, 0);
    assert.equal(skyline.peakAltitude, 0);
  });

  it('counts what it looked at, and how much of it was guessed', () => {
    const skyline = buildSkyline(ORIGIN, [
      blockAt(40, 0, 20),
      { ...blockAt(60, 120, 25), estimated: true },
      { ...blockAt(80, 240, 25), estimated: true },
    ]);
    assert.equal(skyline.considered, 3);
    assert.equal(skyline.estimated, 2);
  });

  it('reports the peak and where it is', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(60, 270, 120), blockAt(60, 90, 12)]);
    assert.ok(skyline.peakAltitude > 55, `${skyline.peakAltitude}`);
    assert.ok(Math.abs(skyline.peakBearing - 270) < 12, `${skyline.peakBearing}`);
  });

  it('knows when the point is inside a building', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(0, 0, 30, 40)]);
    assert.equal(skyline.enclosed, true);
    assert.equal(isSunlit(skyline, 180, 45), false);
  });

  it('is an empty profile when there is nothing around', () => {
    const skyline = buildSkyline(ORIGIN, []);
    assert.equal(skyline.peakAltitude, 0);
    assert.equal(skyline.enclosed, false);
    for (let bearing = 0; bearing < 360; bearing += 7) {
      assert.equal(obstructionAt(skyline, bearing), 0);
    }
  });
});

describe('isSunlit', () => {
  const skyline = buildSkyline(ORIGIN, [blockAt(30, 90, 30, 40)]);

  it('is dark whenever the sun is down, whatever the bearing', () => {
    assert.equal(isSunlit(skyline, 270, -0.5), false);
    assert.equal(isSunlit(skyline, 270, -30), false);
  });

  it('is lit from a clear direction and shaded from a blocked one', () => {
    assert.equal(isSunlit(skyline, 270, 10), true);
    assert.equal(isSunlit(skyline, 90, 10), false);
  });

  it('clears the building once the sun is high enough', () => {
    assert.equal(isSunlit(skyline, 90, 20), false);
    assert.equal(isSunlit(skyline, 90, 75), true);
  });
});

describe('lightWindows', () => {
  // A day that runs east to west: sun rises in the east, sets in the west.
  const day = track([
    [90, -5], // 0 night
    [90, -1], // 1 night
    [90, 5], // 2 up, but the east is blocked
    [100, 12], // 3 still blocked
    [180, 40], // 4 clear and high
    [200, 35], // 5 clear
    [270, 8], // 6 clear, west
    [275, -2], // 7 down
  ]);
  // A 40m-wide, 30m-tall block centred 40m to the east: it covers roughly
  // 68°–122°, so the sun has to climb past it or come round to the south.
  const skyline = buildSkyline(ORIGIN, [blockAt(40, 95, 30, 40)]);

  it('splits the day into runs that tile it exactly', () => {
    const windows = lightWindows(skyline, day);
    assert.equal(windows[0].startMinute, 0);
    assert.equal(windows[windows.length - 1].endMinute, day.length);
    for (let i = 1; i < windows.length; i++) {
      assert.equal(windows[i].startMinute, windows[i - 1].endMinute);
      // Adjacent windows must actually differ, or they would be one window.
      assert.ok(
        windows[i].lit !== windows[i - 1].lit ||
          windows[i].belowHorizon !== windows[i - 1].belowHorizon,
      );
    }
  });

  it('separates night from daytime shade', () => {
    const windows = lightWindows(skyline, day);
    const beforeDawn = windows.find((w) => w.startMinute === 0)!;
    assert.equal(beforeDawn.lit, false);
    assert.equal(beforeDawn.belowHorizon, true);

    const morningShade = windows.find((w) => w.startMinute === 2)!;
    assert.equal(morningShade.lit, false);
    // The sun is up; the spot simply cannot see it yet. A different fact.
    assert.equal(morningShade.belowHorizon, false);
  });

  it('finds the light when the sun comes round', () => {
    const windows = lightWindows(skyline, day);
    const lit = windows.find((w) => w.lit)!;
    assert.equal(lit.startMinute, 4);
    assert.equal(lit.endMinute, 7);
  });

  it('gives a spot with a clear sky light from sunrise to sunset', () => {
    const open = buildSkyline(ORIGIN, []);
    const windows = lightWindows(open, day);
    const summary = summariseLight(windows);
    assert.equal(summary.firstLightMinute, 2);
    assert.equal(summary.lastLightMinute, 6);
    assert.equal(summary.litMinutes, 5);
    assert.equal(summary.shadeWindows.length, 0);
  });

  it('reports no light at all for a spot that never sees the sun', () => {
    const enclosed = buildSkyline(ORIGIN, [blockAt(0, 0, 30, 40)]);
    const summary = summariseLight(lightWindows(enclosed, day));
    assert.equal(summary.firstLightMinute, null);
    assert.equal(summary.lastLightMinute, null);
    assert.equal(summary.litMinutes, 0);
    assert.equal(summary.longestRun, null);
  });
});

describe('summariseLight', () => {
  const day = track([
    [80, -2],
    [90, 6],
    [140, 20],
    [180, 30],
    [220, 25],
    [270, 6],
    [280, -2],
  ]);

  it('picks the longest unbroken run of sun, not the first', () => {
    // Blocked to the south-east only: a short window at dawn, a long one after.
    const skyline = buildSkyline(ORIGIN, [blockAt(25, 140, 22, 30)]);
    const summary = summariseLight(lightWindows(skyline, day));
    assert.ok(summary.longestRun);
    assert.ok(summary.longestRun!.endMinute - summary.longestRun!.startMinute >= 3);
  });

  it('adds the lit windows up to the day total', () => {
    const open = buildSkyline(ORIGIN, []);
    const windows = lightWindows(open, day);
    const summary = summariseLight(windows);
    assert.equal(summary.litMinutes, 5);
    assert.equal(
      summary.litMinutes + windows.filter((w) => !w.lit).reduce((t, w) => t + (w.endMinute - w.startMinute), 0),
      day.length,
    );
  });
});

describe('nextChange', () => {
  const day = track([
    [90, 5],
    [90, 5],
    [180, 40],
    [180, 40],
    [270, 5],
  ]);
  const skyline = buildSkyline(ORIGIN, [blockAt(40, 90, 40, 30)]);
  const windows = lightWindows(skyline, day);

  it('counts the minutes to the next change of state', () => {
    const change = nextChange(windows, 0);
    assert.ok(change);
    assert.equal(change!.lit, true);
    assert.equal(change!.atMinute, 2);
    assert.equal(change!.inMinutes, 2);
  });

  it('counts down as the minute advances', () => {
    assert.equal(nextChange(windows, 1)!.inMinutes, 1);
  });

  it('has nothing to report once there is no change left in the day', () => {
    assert.equal(nextChange(windows, day.length - 1), null);
  });
});

describe('mergeHorizon', () => {
  /** A flat 360° profile at a fixed altitude, as `terrain.ts` would produce. */
  const ridge = (stepDeg: number, at: (bearing: number) => number) => {
    const bins = Math.round(360 / stepDeg);
    const altitudes = new Float64Array(bins);
    for (let bin = 0; bin < bins; bin++) altitudes[bin] = at(bin * stepDeg);
    return { stepDeg, altitudes };
  };

  it('takes whichever obstruction is higher at each bearing', () => {
    // A 20m building 20m to the east: 45° of sky blocked that way and nothing
    // elsewhere. Then a mountain range 10° high all round.
    const skyline = buildSkyline(ORIGIN, [blockAt(20, 90, 20)]);
    const merged = mergeHorizon(skyline, ridge(0.5, () => 10));

    assert.ok(obstructionAt(merged, 90) > 40, 'the building still wins to the east');
    assert.ok(Math.abs(obstructionAt(merged, 270) - 10) < 0.01, 'the mountain wins to the west');
  });

  it('leaves the building profile alone where there is no terrain', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(20, 90, 20)]);
    const merged = mergeHorizon(skyline, ridge(1, () => 0));
    for (const bearing of [0, 45, 90, 180, 270]) {
      assert.ok(
        Math.abs(obstructionAt(merged, bearing) - obstructionAt(skyline, bearing)) < 1e-9,
        `${bearing}°`,
      );
    }
  });

  it('resamples a profile of a different resolution', () => {
    const skyline = buildSkyline(ORIGIN, [], { stepDeg: 0.5 });
    // A ridge only to the south, at a coarser step than the skyline's.
    const merged = mergeHorizon(skyline, ridge(2, (bearing) => (bearing > 170 && bearing < 190 ? 15 : 0)));
    assert.ok(Math.abs(obstructionAt(merged, 180) - 15) < 0.01, `${obstructionAt(merged, 180)}`);
    assert.equal(obstructionAt(merged, 0), 0);
    assert.equal(merged.altitudes.length, skyline.altitudes.length);
  });

  it('moves the peak when the terrain is the taller thing', () => {
    // A 5 m shed 20 m off subtends 14°; the ridge to the west stands at 30°.
    const skyline = buildSkyline(ORIGIN, [blockAt(20, 90, 5)]);
    const merged = mergeHorizon(skyline, ridge(1, (bearing) => (bearing > 250 && bearing < 290 ? 30 : 0)));
    assert.ok(Math.abs(merged.peakBearing - 270) < 45, `peak on ${merged.peakBearing}°`);
    assert.ok(merged.peakAltitude >= 30);
  });

  it('shades a spot the buildings alone would have called lit', () => {
    const skyline = buildSkyline(ORIGIN, []);
    assert.equal(isSunlit(skyline, 270, 8), true);
    const merged = mergeHorizon(skyline, ridge(0.5, () => 12));
    assert.equal(isSunlit(merged, 270, 8), false, 'the mountain is 12° high and the sun is at 8°');
    assert.equal(isSunlit(merged, 270, 20), true);
  });

  it('does nothing with an empty profile', () => {
    const skyline = buildSkyline(ORIGIN, [blockAt(20, 90, 20)]);
    const merged = mergeHorizon(skyline, { stepDeg: 1, altitudes: new Float64Array(0) });
    assert.equal(merged, skyline);
  });
});
