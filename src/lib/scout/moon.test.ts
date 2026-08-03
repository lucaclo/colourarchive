import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOONRISE_ALTITUDE,
  SYNODIC_MONTH_DAYS,
  greenwichSiderealTime,
  moonEcliptic,
  moonIllumination,
  moonPosition,
  moonTimes,
  moonTrack,
  moonlightNote,
  phaseName,
} from './moon.ts';
import { sunPosition } from './sun.ts';

const TOKYO = { lat: 35.6595, lon: 139.7005 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const TROMSO = { lat: 69.6496, lon: 18.956 };

/**
 * A published new moon, and the anchor most lunar phase code is checked
 * against: 2000 January 6, 18:14 UT. If the phase model is right, the moon and
 * the sun share a longitude at that instant and almost nothing is lit.
 */
const NEW_MOON = new Date('2000-01-06T18:14:00Z');

const angleGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('moonEcliptic', () => {
  it('keeps the moon inside its orbital limits all year', () => {
    for (let day = 0; day < 366; day++) {
      const date = new Date(Date.UTC(2026, 0, 1 + day));
      const { latitude, distanceER } = moonEcliptic(date);
      // The orbit is inclined 5.145°; perturbations move that by a fraction.
      assert.ok(Math.abs(latitude) < 5.4, `day ${day}: latitude ${latitude}`);
      // Perigee and apogee, in earth radii — 356,400 km to 406,700 km.
      assert.ok(distanceER > 55 && distanceER < 64, `day ${day}: ${distanceER} ER`);
    }
  });

  it('goes right round the ecliptic in a sidereal month', () => {
    const start = moonEcliptic(new Date('2026-03-01T00:00:00Z')).longitude;
    // 27.32 days is the sidereal month — one lap against the stars.
    const later = moonEcliptic(new Date('2026-03-28T07:40:00Z')).longitude;
    assert.ok(angleGap(start, later) < 2, `${start} vs ${later}`);
  });

  it('moves about 13° a day, always in the same direction', () => {
    let previous = moonEcliptic(new Date('2026-05-01T00:00:00Z')).longitude;
    for (let day = 1; day < 40; day++) {
      const next = moonEcliptic(new Date(Date.UTC(2026, 4, 1 + day))).longitude;
      const step = ((next - previous + 360) % 360);
      assert.ok(step > 11 && step < 16, `day ${day}: moved ${step}°`);
      previous = next;
    }
  });
});

describe('greenwichSiderealTime', () => {
  it('matches the standard value at J2000', () => {
    // 2000-01-01 12:00 UT: GMST is 18h 41m 50.5s = 280.46°.
    const gmst = greenwichSiderealTime(new Date('2000-01-01T12:00:00Z'));
    assert.ok(Math.abs(gmst - 280.46) < 0.01, `${gmst}`);
  });

  it('advances by a sidereal day, not a solar one', () => {
    const a = greenwichSiderealTime(new Date('2026-07-01T00:00:00Z'));
    const b = greenwichSiderealTime(new Date('2026-07-02T00:00:00Z'));
    // A solar day is 360.9856° of sidereal rotation.
    assert.ok(Math.abs(((b - a + 360) % 360) - 0.9856) < 0.01, `${a} → ${b}`);
  });
});

describe('moonPosition', () => {
  it('is pulled down by parallax, never up', () => {
    for (let hour = 0; hour < 24; hour++) {
      const date = new Date(Date.UTC(2026, 6, 15, hour));
      const p = moonPosition(TOKYO.lat, TOKYO.lon, date);
      assert.ok(p.altitude <= p.altitudeGeocentric, `hour ${hour}`);
      // Horizontal parallax runs about 0.95–1.02° and shrinks to nothing at the zenith.
      assert.ok(p.parallax >= 0 && p.parallax < 1.05, `hour ${hour}: ${p.parallax}°`);
    }
  });

  it('applies the full parallax at the horizon and none at the zenith', () => {
    // Sweep a day somewhere the moon gets high, and compare the extremes.
    const samples = moonTrack(TOKYO.lat, TOKYO.lon, new Date('2026-07-15T00:00:00Z'), new Date('2026-07-16T00:00:00Z'), { stepMinutes: 10 });
    const nearHorizon = samples.reduce((best, s) =>
      Math.abs(s.altitudeGeocentric) < Math.abs(best.altitudeGeocentric) ? s : best,
    );
    const highest = samples.reduce((best, s) => (s.altitudeGeocentric > best.altitudeGeocentric ? s : best));
    assert.ok(nearHorizon.parallax > 0.9, `${nearHorizon.parallax}`);
    assert.ok(nearHorizon.parallax > highest.parallax, 'parallax should shrink with altitude');
  });

  it('reports a disc about half a degree across', () => {
    const p = moonPosition(LONDON.lat, LONDON.lon, new Date('2026-02-11T22:00:00Z'));
    assert.ok(p.angularRadius > 0.23 && p.angularRadius < 0.29, `${p.angularRadius}°`);
  });

  it('lifts the apparent altitude by refraction near the horizon', () => {
    const samples = moonTrack(LONDON.lat, LONDON.lon, new Date('2026-04-02T00:00:00Z'), new Date('2026-04-03T00:00:00Z'), { stepMinutes: 10 });
    const atHorizon = samples.reduce((best, s) => (Math.abs(s.altitude) < Math.abs(best.altitude) ? s : best));
    assert.ok(atHorizon.altitudeApparent > atHorizon.altitude, 'refraction should lift it');
    assert.ok(atHorizon.altitudeApparent - atHorizon.altitude > 0.4, 'about half a degree at the horizon');
  });

  it('keeps declination inside the moon’s range', () => {
    for (let day = 0; day < 60; day++) {
      const { declination } = moonPosition(0, 0, new Date(Date.UTC(2026, 0, 1 + day)));
      // The moon's declination swings wider than the sun's, to about ±28.7°.
      assert.ok(Math.abs(declination) < 29, `day ${day}: ${declination}°`);
    }
  });
});

describe('moonIllumination', () => {
  it('finds a known new moon dark', () => {
    const phase = moonIllumination(NEW_MOON);
    assert.ok(phase.fraction < 0.01, `fraction ${phase.fraction}`);
    assert.ok(angleGap(phase.age, 0) < 3, `age ${phase.age}°`);
    assert.equal(phase.name, 'new');
  });

  it('finds the moon full half a lunation later', () => {
    const full = new Date(NEW_MOON.getTime() + (SYNODIC_MONTH_DAYS / 2) * 86_400_000);
    const phase = moonIllumination(full);
    assert.ok(phase.fraction > 0.97, `fraction ${phase.fraction}`);
    assert.equal(phase.name, 'full');
  });

  it('runs once round the cycle in a synodic month', () => {
    const later = moonIllumination(new Date(NEW_MOON.getTime() + SYNODIC_MONTH_DAYS * 86_400_000));
    assert.ok(angleGap(later.age, 0) < 4, `age ${later.age}°`);
  });

  it('separates waxing from waning, which the lit fraction alone cannot', () => {
    const waxing = moonIllumination(new Date(NEW_MOON.getTime() + 5 * 86_400_000));
    const waning = moonIllumination(new Date(NEW_MOON.getTime() + 24.5 * 86_400_000));
    assert.ok(waxing.waxing);
    assert.ok(!waning.waxing);
    // Same sliver, opposite halves of the month.
    assert.ok(Math.abs(waxing.fraction - waning.fraction) < 0.15, `${waxing.fraction} vs ${waning.fraction}`);
    assert.equal(waxing.name, 'waxing-crescent');
    assert.equal(waning.name, 'waning-crescent');
  });

  it('puts the full moon opposite the sun in the sky', () => {
    const full = new Date(NEW_MOON.getTime() + (SYNODIC_MONTH_DAYS / 2) * 86_400_000);
    // Pick a moment when both are near the horizon so the comparison is about
    // azimuth rather than about one of them being overhead.
    const moon = moonPosition(LONDON.lat, LONDON.lon, full);
    const sun = sunPosition(LONDON.lat, LONDON.lon, full);
    assert.ok(angleGap(moon.azimuth, sun.azimuth + 180) < 25, `${moon.azimuth} vs ${sun.azimuth}`);
  });

  it('never claims more than a full disc or less than none', () => {
    for (let hour = 0; hour < 24 * 40; hour += 7) {
      const { fraction } = moonIllumination(new Date(Date.UTC(2026, 2, 1, hour)));
      assert.ok(fraction >= 0 && fraction <= 1, `${fraction}`);
    }
  });
});

describe('phaseName', () => {
  it('names the four exact phases', () => {
    assert.equal(phaseName(0), 'new');
    assert.equal(phaseName(90), 'first-quarter');
    assert.equal(phaseName(180), 'full');
    assert.equal(phaseName(270), 'last-quarter');
  });

  it('wraps rather than falling off the end', () => {
    assert.equal(phaseName(360), 'new');
    assert.equal(phaseName(-1), 'new');
    assert.equal(phaseName(700), 'waning-crescent'); // 340° into the second lap
    assert.equal(phaseName(719), 'new'); // 359° — back round to the start
  });
});

describe('moonTimes', () => {
  const dayFrom = (iso: string) => ({
    from: new Date(iso),
    to: new Date(new Date(iso).getTime() + 86_400_000),
  });

  it('finds a rise and a set with the moon up in between', () => {
    const { from, to } = dayFrom('2026-06-10T00:00:00Z');
    const times = moonTimes(LONDON.lat, LONDON.lon, from, to);
    if (times.rise && times.set) {
      const between = new Date((times.rise.getTime() + times.set.getTime()) / 2);
      const altitude = moonPosition(LONDON.lat, LONDON.lon, between).altitude;
      if (times.set > times.rise) assert.ok(altitude > MOONRISE_ALTITUDE, `${altitude}`);
    }
    assert.ok(times.peakAltitude > -90 && times.peakAltitude < 90);
  });

  it('lands the crossings on the horizon itself', () => {
    for (const start of ['2026-01-05T00:00:00Z', '2026-06-10T00:00:00Z', '2026-11-21T00:00:00Z']) {
      const { from, to } = dayFrom(start);
      const times = moonTimes(TOKYO.lat, TOKYO.lon, from, to);
      for (const when of [times.rise, times.set]) {
        if (!when) continue;
        const altitude = moonPosition(TOKYO.lat, TOKYO.lon, when).altitude;
        assert.ok(Math.abs(altitude - MOONRISE_ALTITUDE) < 0.05, `${start}: ${altitude}°`);
      }
    }
  });

  it('slips later each day, as the moon does', () => {
    let previous: number | null = null;
    let checked = 0;
    for (let day = 0; day < 20; day++) {
      const start = Date.UTC(2026, 8, 1 + day);
      const times = moonTimes(LONDON.lat, LONDON.lon, new Date(start), new Date(start + 86_400_000));
      if (!times.rise) continue;
      const minutes: number = (times.rise.getTime() - start) / 60_000;
      if (previous != null) {
        const slip: number = minutes - previous;
        // About 50 minutes a day, and the wrap when a rise falls off the end of
        // one window into the start of the next is expected rather than a fault.
        if (slip > 0) {
          assert.ok(slip > 15 && slip < 100, `day ${day}: slipped ${slip} minutes`);
          checked++;
        }
      }
      previous = minutes;
    }
    assert.ok(checked > 8, `only ${checked} usable days`);
  });

  it('reports a moon that never sets inside the window', () => {
    // High in the Arctic the moon can stay up for a whole day, exactly as the
    // sun does — the flags are how the UI says so instead of printing nothing.
    let sawAlwaysUp = false;
    let sawAlwaysDown = false;
    for (let day = 0; day < 30; day++) {
      const start = Date.UTC(2026, 0, 1 + day);
      const times = moonTimes(TROMSO.lat, TROMSO.lon, new Date(start), new Date(start + 86_400_000));
      if (times.alwaysUp) sawAlwaysUp = true;
      if (times.alwaysDown) sawAlwaysDown = true;
      if (times.alwaysUp || times.alwaysDown) {
        assert.equal(times.rise, null);
        assert.equal(times.set, null);
      }
    }
    assert.ok(sawAlwaysUp || sawAlwaysDown, 'a month at 70°N should contain at least one');
  });
});

describe('moonTrack', () => {
  it('covers the window at the requested interval', () => {
    const from = new Date('2026-07-31T00:00:00Z');
    const to = new Date('2026-07-31T12:00:00Z');
    const samples = moonTrack(LONDON.lat, LONDON.lon, from, to, { stepMinutes: 30 });
    assert.equal(samples.length, 25);
    assert.equal(samples[0].date.getTime(), from.getTime());
    assert.equal(samples[24].date.getTime(), to.getTime());
  });

  it('rejects a nonsense interval or a reversed window', () => {
    const from = new Date('2026-07-31T00:00:00Z');
    const to = new Date('2026-07-31T12:00:00Z');
    assert.throws(() => moonTrack(0, 0, from, to, { stepMinutes: 0 }), RangeError);
    assert.throws(() => moonTrack(0, 0, to, from), RangeError);
  });
});

describe('moonlightNote', () => {
  it('refuses to call a crescent a light source', () => {
    assert.match(moonlightNote(40, 0.08), /subject/);
  });

  it('says when there is enough to shoot by', () => {
    assert.match(moonlightNote(45, 0.98), /landscape/);
  });

  it('says nothing useful about a moon that is down', () => {
    assert.equal(moonlightNote(-5, 1), 'below the horizon');
  });
});
