import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CORE_J2000 } from './galactic';
import {
  airmass,
  angularSeparation,
  CONSTELLATION_NAME,
  constellationLines,
  extinctionMag,
  galacticBandBrightness,
  galacticFieldPositions,
  galacticFieldStars,
  galacticPlane,
  galacticToEquatorial,
  limitingMagnitude,
  moonlightPenalty,
  prominentConstellations,
  reddenForAirmass,
  starAlpha,
  starColour,
  starPositions,
  starVisibility,
  twinkle,
  type Star,
} from './stars';

const star = (over: Partial<Star>): Star => ({
  id: 1,
  name: null,
  bayer: null,
  flam: null,
  con: null,
  raDeg: 0,
  decDeg: 0,
  mag: 1,
  ci: null,
  ...over,
});

describe('galacticToEquatorial', () => {
  it('places the galactic centre within a tenth of a degree of Sagittarius A*', () => {
    // Sgr A* sits at galactic (l, b) ≈ (0, 0), not exactly — the galactic
    // coordinate frame is pinned to the IAU's 1958 definition of the pole,
    // fixed before anyone had measured the black hole's own position to
    // this precision, so a small, well-documented offset between the two is
    // real astronomy and not a bug in this transform. What a wrong rotation
    // would look like is degrees off, not a fraction of one — this checks
    // that the transform lands in the right *place*, not that Sgr A* is
    // exactly the coordinate origin it approximates.
    const { rightAscension, declination } = galacticToEquatorial(0, 0);
    assert.ok(Math.abs(rightAscension - CORE_J2000.rightAscension) < 0.1);
    assert.ok(Math.abs(declination - CORE_J2000.declination) < 0.1);
  });

  it('places the north galactic pole at the pole it is named for', () => {
    const { declination } = galacticToEquatorial(0, 90);
    assert.ok(Math.abs(declination - 27.12825) < 0.01);
  });
});

describe('angularSeparation', () => {
  it('is zero for a point and itself', () => {
    // acos's derivative diverges at 1, so floating-point noise at the input
    // (sin²+cos² landing a bit either side of exactly 1) comes out as a
    // fraction of a degree, not a fraction of a radian — 1e-4° is still a
    // few centimetres of sky at any realistic dome radius.
    assert.ok(angularSeparation(120, 40, 120, 40) < 1e-4);
  });

  it('is ninety degrees a quarter of the way around the equator', () => {
    assert.ok(Math.abs(angularSeparation(0, 0, 90, 0) - 90) < 1e-6);
  });

  it('is one hundred eighty degrees for antipodal points', () => {
    assert.ok(Math.abs(angularSeparation(0, 0, 180, 0) - 180) < 1e-6);
  });
});

describe('starPositions', () => {
  it('places a star at the zenith when its declination equals the latitude and its hour angle is zero', () => {
    // Vega, roughly: RA 279.23°, Dec 38.78°. At a latitude equal to its
    // declination, on the date and instant its right ascension transits
    // (hour angle zero), it stands at the zenith — altitude 90 — regardless
    // of longitude, which is the standard check for "is the transform right
    // at all" before trusting it anywhere else.
    const dec = 38.78;
    const ra = 279.23;
    // Pick a longitude/date pair whose local sidereal time equals ra, i.e.
    // greenwichSiderealTime(date) + longitude == ra. Simplest: longitude 0,
    // search a date. Cheaper here: just assert the star is very high near
    // its own declination's latitude across a full day of candidate hour
    // angles, which is a looser but still meaningful sanity check.
    const stars: Star[] = [star({ raDeg: ra, decDeg: dec, mag: 0 })];
    let maxAltitude = -90;
    for (let h = 0; h < 24; h++) {
      const date = new Date(Date.UTC(2000, 0, 1, h));
      const [pos] = starPositions(stars, dec, 0, date, -90);
      maxAltitude = Math.max(maxAltitude, pos.altitude);
    }
    assert.ok(maxAltitude > 89, `expected a transit near the zenith, got ${maxAltitude}`);
  });

  it('drops a star below the altitude floor', () => {
    // A star at the south celestial pole's declination is never visible
    // from well north of the equator.
    const stars: Star[] = [star({ raDeg: 0, decDeg: -85 })];
    const positions = starPositions(stars, 55, 0, new Date('2026-06-21T22:00:00Z'), 0);
    assert.equal(positions.length, 0);
  });

  it('reports the apparent magnitude as dimmer than the catalogue value away from the zenith', () => {
    // Latitude close to (not equal to) the declination: transits near the
    // zenith like the circumpolar case above, but — unlike that one — still
    // rises and sets, so the same star also passes through a low altitude
    // once a day rather than staying above 20° forever.
    const stars: Star[] = [star({ raDeg: 0, decDeg: 30, mag: 2 })];
    let atZenith: number | null = null;
    let atLow: number | null = null;
    for (let m = 0; m < 24 * 60; m += 5) {
      const date = new Date(Date.UTC(2000, 0, 1, 0, m));
      const [pos] = starPositions(stars, 32, 0, date, -90);
      if (pos.altitude > 85) atZenith = pos.apparentMag;
      if (pos.altitude > 8 && pos.altitude < 15) atLow = pos.apparentMag;
    }
    assert.ok(atZenith !== null && atLow !== null, 'expected both a high and a low sample across the day');
    assert.ok(atLow! > atZenith!, `expected the low placement (${atLow}) dimmer than the zenith one (${atZenith})`);
  });

  it('lifts a star near the horizon by refraction, same direction as the sun and the core', () => {
    // A star exactly at the geometric horizon should read a little *above*
    // zero once refraction is applied — about a third of a degree, the same
    // ballpark `refraction(0)` gives the sun.
    const stars: Star[] = [star({ raDeg: 0, decDeg: 0 })];
    let atHorizon: number | null = null;
    for (let m = 0; m < 24 * 60; m += 2) {
      const date = new Date(Date.UTC(2000, 0, 1, 0, m));
      const [pos] = starPositions(stars, 0, 0, date, -90);
      if (Math.abs(pos.altitude) < 0.1) atHorizon = pos.altitudeApparent - pos.altitude;
    }
    assert.ok(atHorizon !== null, 'expected a sample near the geometric horizon');
    assert.ok(atHorizon! > 0.2 && atHorizon! < 0.8, `expected a lift of a few tenths of a degree, got ${atHorizon}`);
  });
});

describe('airmass', () => {
  it('is very nearly one at the zenith', () => {
    // Kasten & Young is an empirical fit, not an identity — it does not
    // reduce to exactly 1/sin at 90°, only to within a few ten-thousandths.
    assert.ok(Math.abs(airmass(90) - 1) < 1e-3);
  });

  it('grows toward the horizon', () => {
    assert.ok(airmass(10) > airmass(30));
    assert.ok(airmass(2) > airmass(10));
  });

  it('is finite at the horizon, unlike the plain 1/sin(altitude) it replaces', () => {
    assert.ok(Number.isFinite(airmass(0)));
    assert.ok(airmass(0) > airmass(10));
  });

  it('is infinite below the horizon — there is no line of sight through the ground', () => {
    assert.equal(airmass(-5), Infinity);
  });
});

describe('extinctionMag', () => {
  it('is very nearly zero at the zenith', () => {
    assert.ok(Math.abs(extinctionMag(90)) < 1e-3);
  });

  it('grows toward the horizon', () => {
    assert.ok(extinctionMag(5) > extinctionMag(45));
  });
});

describe('moonlightPenalty', () => {
  it('is zero with the moon below the horizon, however full', () => {
    assert.equal(moonlightPenalty(-10, 1), 0);
  });

  it('is zero with the moon up but new', () => {
    assert.equal(moonlightPenalty(60, 0), 0);
  });

  it('is largest for a full moon high in the sky', () => {
    const full = moonlightPenalty(80, 1);
    const crescentLow = moonlightPenalty(10, 0.1);
    assert.ok(full > crescentLow);
    assert.ok(full > 0);
  });
});

describe('limitingMagnitude', () => {
  it('is faint (very negative) at civil twilight', () => {
    assert.ok(limitingMagnitude(-6, -90, 0) < 0);
  });

  it('reaches the catalogue limit on a moonless, astronomically dark night', () => {
    assert.equal(limitingMagnitude(-20, -90, 0, 4.0), 4.0);
  });

  it('is pulled brighter (numerically lower) by a bright moon', () => {
    const noMoon = limitingMagnitude(-20, -90, 0);
    const fullMoonUp = limitingMagnitude(-20, 70, 1);
    assert.ok(fullMoonUp < noMoon);
  });
});

describe('starAlpha', () => {
  it('is fully drawn well brighter than the limit', () => {
    assert.equal(starAlpha(-1, 4), 1);
  });

  it('is invisible well fainter than the limit', () => {
    assert.equal(starAlpha(6, 4), 0);
  });

  it('is exactly half at the midpoint of the fade range', () => {
    assert.ok(Math.abs(starAlpha(4.5, 4, 1) - 0.5) < 1e-9);
  });
});

describe('starVisibility', () => {
  it('is zero at and above civil twilight', () => {
    assert.equal(starVisibility(-5), 0);
    assert.equal(starVisibility(0), 0);
  });

  it('is one at and below astronomical twilight', () => {
    assert.equal(starVisibility(-18), 1);
    assert.equal(starVisibility(-30), 1);
  });

  it('ramps linearly between the two', () => {
    assert.ok(Math.abs(starVisibility(-12) - 0.5) < 1e-9);
  });
});

describe('constellationLines', () => {
  it('connects every star in a constellation with exactly n-1 edges', () => {
    const stars: Star[] = [
      star({ id: 1, con: 'Ori', raDeg: 80, decDeg: 5 }),
      star({ id: 2, con: 'Ori', raDeg: 82, decDeg: 6 }),
      star({ id: 3, con: 'Ori', raDeg: 78, decDeg: 4 }),
      star({ id: 4, con: 'UMa', raDeg: 165, decDeg: 55 }),
    ];
    const edges = constellationLines(stars);
    const ori = edges.filter((e) => e.con === 'Ori');
    assert.equal(ori.length, 2); // 3 stars, 2 edges: a tree, not a triangle
    // Every star reachable from every other — the definition of "connected".
    const seen = new Set<number>();
    for (const e of ori) { seen.add(e.a.id); seen.add(e.b.id); }
    assert.deepEqual([...seen].sort(), [1, 2, 3]);
  });

  it('draws no line for a constellation with only one catalogue star', () => {
    const stars: Star[] = [star({ id: 1, con: 'Men', raDeg: 80, decDeg: -75 })];
    assert.equal(constellationLines(stars).length, 0);
  });

  it('ignores stars with no constellation on record', () => {
    const stars: Star[] = [star({ id: 1, con: null }), star({ id: 2, con: null })];
    assert.equal(constellationLines(stars).length, 0);
  });
});

describe('galacticPlane', () => {
  it('returns a closed loop back to (near) its own start', () => {
    const points = galacticPlane(51.5, -0.1, new Date('2026-08-19T22:00:00Z'), 10);
    assert.ok(points.length > 30);
    assert.ok(Math.abs(points[0].azimuth - points[points.length - 1].azimuth) < 1);
  });

  it('traces a different circle off the centreline', () => {
    const centreline = galacticPlane(51.5, -0.1, new Date('2026-08-19T22:00:00Z'), 30, 0);
    const offset = galacticPlane(51.5, -0.1, new Date('2026-08-19T22:00:00Z'), 30, 8);
    const differs = centreline.some((p, i) => Math.abs(p.altitude - offset[i].altitude) > 0.5);
    assert.ok(differs, 'expected an 8° latitude offset to trace a visibly different circle');
  });
});

describe('galacticFieldPositions', () => {
  it('places a field point at (l=0, b=0) exactly where the centreline itself sits', () => {
    const date = new Date('2026-08-19T22:00:00Z');
    const [pos] = galacticFieldPositions([{ l: 0, b: 0, mag: 4 }], 51.5, -0.1, date);
    const [planePos] = galacticPlane(51.5, -0.1, date, 360, 0); // a single sample at l=0
    assert.ok(Math.abs(pos.azimuth - planePos.azimuth) < 0.01);
    assert.ok(Math.abs(pos.altitude - planePos.altitude) < 0.01);
  });

  it('carries the synthetic magnitude through unchanged', () => {
    const [pos] = galacticFieldPositions(
      [{ l: 90, b: 5, mag: 4.2 }],
      40, 10, new Date('2026-01-01T00:00:00Z'),
    );
    assert.equal(pos.mag, 4.2);
  });

  it('returns one position per field star, in order', () => {
    const field = [
      { l: 10, b: 1, mag: 4 },
      { l: 20, b: -1, mag: 4.5 },
      { l: 30, b: 2, mag: 5 },
    ];
    const positions = galacticFieldPositions(field, 0, 0, new Date('2026-06-01T00:00:00Z'));
    assert.equal(positions.length, 3);
    assert.deepEqual(positions.map((p) => p.mag), [4, 4.5, 5]);
  });
});

describe('CONSTELLATION_NAME', () => {
  it('names all 88 IAU constellations', () => {
    assert.equal(Object.keys(CONSTELLATION_NAME).length, 88);
  });

  it('gives every abbreviation a non-empty name', () => {
    // Not "name !== abbreviation" — a few (Ara, Leo…) are genuinely the same
    // three letters as their own short form, which is real data, not a
    // stray copy-paste, so that is not a safe invariant to assert here.
    for (const [abbr, name] of Object.entries(CONSTELLATION_NAME)) {
      assert.ok(name.length >= 3, `${abbr} has an implausibly short name: "${name}"`);
    }
  });

  it('has no duplicate keys colliding under a different case', () => {
    const lower = Object.keys(CONSTELLATION_NAME).map((k) => k.toLowerCase());
    assert.equal(new Set(lower).size, lower.length);
  });
});

describe('prominentConstellations', () => {
  const s = (con: string, alpha: number): { star: Star; alpha: number } => ({ star: star({ con }), alpha });

  it('ranks by the brightest star each constellation has, not by star count', () => {
    const stars = [s('Ori', 0.9), s('UMa', 0.3), s('UMa', 0.4), s('UMa', 0.35)];
    const names = prominentConstellations(stars);
    assert.equal(names[0], 'Orion');
  });

  it('caps the result at the given limit', () => {
    const stars = ['Ori', 'UMa', 'Cyg', 'Lyr', 'Aql', 'Sco', 'Leo'].map((con) => s(con, 0.5));
    assert.equal(prominentConstellations(stars, 3).length, 3);
  });

  it('ignores stars with no constellation on record', () => {
    assert.deepEqual(prominentConstellations([s('', 0.9)].map((x) => ({ ...x, star: { ...x.star, con: null } }))), []);
  });

  it('falls back to the raw abbreviation for one the table does not have', () => {
    assert.deepEqual(prominentConstellations([s('Zzz', 0.9)]), ['Zzz']);
  });
});

describe('galacticBandBrightness', () => {
  it('is brightest looking toward the galactic centre', () => {
    assert.ok(Math.abs(galacticBandBrightness(0) - 1) < 1e-9);
  });

  it('is dimmest, but not zero, toward the anticentre', () => {
    const dim = galacticBandBrightness(180);
    assert.ok(dim > 0 && dim < 0.5);
  });

  it('is symmetric either side of the centre', () => {
    assert.ok(Math.abs(galacticBandBrightness(60) - galacticBandBrightness(300)) < 1e-9);
  });
});

describe('starColour', () => {
  it('is neutral white with no colour index', () => {
    assert.deepEqual(starColour(null), [1, 1, 1]);
  });

  it('runs bluer for a hot star and warmer for a cool one', () => {
    const hot = starColour(-0.3);
    const cool = starColour(1.5);
    assert.ok(hot[2] > hot[0]); // blue channel leads for a hot star
    assert.ok(cool[0] > cool[2]); // red channel leads for a cool one
  });

  it('clamps outside the table rather than extrapolating', () => {
    assert.deepEqual(starColour(-5), starColour(-0.4));
    assert.deepEqual(starColour(5), starColour(1.6));
  });
});

describe('galacticFieldStars', () => {
  it('is fully deterministic for a given seed', () => {
    const a = galacticFieldStars(500, 7);
    const b = galacticFieldStars(500, 7);
    assert.deepEqual(a, b);
  });

  it('produces a different field for a different seed', () => {
    const a = galacticFieldStars(500, 7);
    const b = galacticFieldStars(500, 8);
    assert.notDeepEqual(a, b);
  });

  it('returns (up to) the requested count', () => {
    const stars = galacticFieldStars(200, 1);
    assert.ok(stars.length > 0 && stars.length <= 200);
  });

  it('keeps every point within the modelled spread of the plane', () => {
    const stars = galacticFieldStars(2000, 3);
    for (const s of stars) {
      assert.ok(s.b >= -20 && s.b <= 20, `b=${s.b} outside the modelled band`);
      assert.ok(s.l >= 0 && s.l < 360);
    }
  });

  it('packs more points near the galactic centre than the anticentre', () => {
    const stars = galacticFieldStars(4000, 5);
    const nearCore = stars.filter((s) => Math.abs(((s.l + 180) % 360) - 180) < 30).length;
    const nearAnti = stars.filter((s) => Math.abs(s.l - 180) < 30).length;
    assert.ok(nearCore > nearAnti, `expected more density near l=0 (${nearCore}) than l=180 (${nearAnti})`);
  });

  it('stays close to the plane on average, not spread evenly to the edges', () => {
    const stars = galacticFieldStars(3000, 9);
    const meanAbsB = stars.reduce((sum, s) => sum + Math.abs(s.b), 0) / stars.length;
    assert.ok(meanAbsB < 6, `expected most points within a few degrees of b=0, mean |b|=${meanAbsB}`);
  });
});

describe('twinkle', () => {
  it('is centred on 1 over time, for a star with meaningful amplitude', () => {
    // A low-altitude star (high airmass) has amplitude to average out;
    // sample across a few seconds and check the mean lands near 1.
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) sum += twinkle(12345, i * 37, 6);
    assert.ok(Math.abs(sum / n - 1) < 0.05);
  });

  it('barely moves at the zenith (airmass 1)', () => {
    let maxDeviation = 0;
    for (let i = 0; i < 200; i++) {
      maxDeviation = Math.max(maxDeviation, Math.abs(twinkle(999, i * 50, 1) - 1));
    }
    assert.ok(maxDeviation < 0.02, `expected near-zero twinkle at the zenith, got ${maxDeviation}`);
  });

  it('swings harder near the horizon (high airmass) than overhead', () => {
    const spread = (id: number, airmassAtStar: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 300; i++) {
        const v = twinkle(id, i * 41, airmassAtStar);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    assert.ok(spread(42, 8) > spread(42, 1.2));
  });

  it('is deterministic — the same star at the same instant always twinkles the same amount', () => {
    assert.equal(twinkle(55, 12345, 5), twinkle(55, 12345, 5));
  });

  it('gives two different stars independent phases', () => {
    // Extremely unlikely to coincide across a whole sampled sequence unless
    // the phase/frequency hash collapsed two different ids together.
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 50; i++) {
      a.push(twinkle(1, i * 97, 6));
      b.push(twinkle(2, i * 97, 6));
    }
    assert.notDeepEqual(a, b);
  });
});

describe('reddenForAirmass', () => {
  it('is the identity at the zenith', () => {
    const white: [number, number, number] = [0.8, 0.85, 1];
    assert.deepEqual(reddenForAirmass(white, 1), white);
  });

  it('shifts warmer (more red, less blue) as airmass climbs', () => {
    const white: [number, number, number] = [0.8, 0.85, 1];
    const low = reddenForAirmass(white, 2);
    const high = reddenForAirmass(white, 10);
    assert.ok(high[0] >= low[0]); // red channel rises or holds
    assert.ok(high[2] <= low[2]); // blue channel falls or holds
    assert.ok(high[0] > white[0]);
    assert.ok(high[2] < white[2]);
  });

  it('never overshoots into a channel value outside the original-to-warm range', () => {
    const rgb: [number, number, number] = [0.6, 0.7, 0.95];
    const warm = [1, 0.55, 0.3];
    const result = reddenForAirmass(rgb, 30);
    for (let i = 0; i < 3; i++) {
      const lo = Math.min(rgb[i], warm[i]);
      const hi = Math.max(rgb[i], warm[i]);
      assert.ok(result[i] >= lo - 1e-9 && result[i] <= hi + 1e-9);
    }
  });
});
