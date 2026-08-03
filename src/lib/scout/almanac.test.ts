import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  apparentSolarLongitude,
  bracketingSolstices,
  nextSeasonEvent,
  seasonEvents,
  seasonName,
  solarLongitudeCrossing,
} from './almanac.ts';
import { sunPosition, sunTimes } from './sun.ts';

const signedGap = (a: number, b: number) => ((a - b + 540) % 360) - 180;

describe('apparentSolarLongitude', () => {
  it('advances about a degree a day, all the way round in a year', () => {
    const start = apparentSolarLongitude(new Date('2026-01-01T00:00:00Z'));
    const end = apparentSolarLongitude(new Date('2027-01-01T00:00:00Z'));
    assert.ok(Math.abs(signedGap(end, start)) < 1.2, `${start} → ${end}`);
  });

  it('is zero at the March equinox and 180 at the September one', () => {
    const [march, , september] = seasonEvents(2026);
    assert.ok(Math.abs(signedGap(apparentSolarLongitude(march.date), 0)) < 0.001);
    assert.ok(Math.abs(signedGap(apparentSolarLongitude(september.date), 180)) < 0.001);
  });
});

describe('solarLongitudeCrossing', () => {
  it('lands on the target longitude from a seed a week out', () => {
    const found = solarLongitudeCrossing(90, new Date('2026-06-14T00:00:00Z'));
    assert.ok(Math.abs(signedGap(apparentSolarLongitude(found), 90)) < 0.0005, `${found.toISOString()}`);
  });

  it('converges to the same instant from either side', () => {
    const early = solarLongitudeCrossing(270, new Date('2026-12-14T00:00:00Z'));
    const late = solarLongitudeCrossing(270, new Date('2026-12-28T00:00:00Z'));
    assert.ok(Math.abs(early.getTime() - late.getTime()) < 2000, `${early} vs ${late}`);
  });
});

describe('seasonEvents', () => {
  it('puts each event in the right few days of the right month', () => {
    // The equinoxes and solstices drift across a three-day window with the leap
    // cycle; anything outside it means the solver has locked onto the wrong root.
    const windows: Record<string, { month: number; from: number; to: number }> = {
      'march-equinox': { month: 2, from: 19, to: 21 },
      'june-solstice': { month: 5, from: 20, to: 22 },
      'september-equinox': { month: 8, from: 21, to: 24 },
      'december-solstice': { month: 11, from: 20, to: 23 },
    };
    for (const year of [1999, 2024, 2026, 2031, 2050]) {
      for (const event of seasonEvents(year)) {
        const window = windows[event.key];
        assert.equal(event.date.getUTCFullYear(), year, `${year} ${event.key}`);
        assert.equal(event.date.getUTCMonth(), window.month, `${year} ${event.key}`);
        const day = event.date.getUTCDate();
        assert.ok(day >= window.from && day <= window.to, `${year} ${event.key}: day ${day}`);
      }
    }
  });

  it('agrees with the published 2026 events to the precision the model has', () => {
    // Published instants, for the record. The bound is fifteen minutes because
    // that is what a 0.01° solar-longitude model is worth — measured errors here
    // are −7.9, −4.4, +4.1 and −1.2 minutes. Tightening this assertion without
    // first replacing the solar series would be asserting an accuracy that does
    // not exist; loosening it would stop catching a real regression.
    const published: Record<string, string> = {
      'march-equinox': '2026-03-20T14:45:36Z',
      'june-solstice': '2026-06-21T08:25:00Z',
      'september-equinox': '2026-09-23T00:05:38Z',
      'december-solstice': '2026-12-21T20:50:22Z',
    };
    for (const event of seasonEvents(2026)) {
      const offMinutes = (event.date.getTime() - Date.parse(published[event.key])) / 60_000;
      assert.ok(
        Math.abs(offMinutes) < 15,
        `${event.key}: computed ${event.date.toISOString()}, ${offMinutes.toFixed(1)} min out`,
      );
    }
  });

  it('gets the calendar date right, which is all it is ever printed to', () => {
    const published: Record<string, string> = {
      'march-equinox': '2026-03-20',
      'june-solstice': '2026-06-21',
      'september-equinox': '2026-09-23',
      'december-solstice': '2026-12-21',
    };
    for (const event of seasonEvents(2026)) {
      assert.equal(event.date.toISOString().slice(0, 10), published[event.key], event.key);
    }
  });

  it('puts the sun at its declination extremes on the solstices', () => {
    const [, june, , december] = seasonEvents(2026);
    const north = sunPosition(0, 0, june.date).declination;
    const south = sunPosition(0, 0, december.date).declination;
    // The obliquity of the ecliptic, which is what a solstice *is*.
    assert.ok(Math.abs(north - 23.44) < 0.02, `June: ${north}°`);
    assert.ok(Math.abs(south + 23.44) < 0.02, `December: ${south}°`);
  });

  it('marks the longest and shortest days of the year', () => {
    const [, june, , december] = seasonEvents(2026);
    const lengthOn = (date: Date) => sunTimes(51.5074, -0.1278, date).dayLengthMinutes ?? 0;
    const midsummer = lengthOn(june.date);
    const midwinter = lengthOn(december.date);
    for (const offsetDays of [-40, -10, 10, 40]) {
      const shifted = (from: Date) => new Date(from.getTime() + offsetDays * 86_400_000);
      assert.ok(lengthOn(shifted(june.date)) <= midsummer + 0.5, `June ${offsetDays}d`);
      assert.ok(lengthOn(shifted(december.date)) >= midwinter - 0.5, `December ${offsetDays}d`);
    }
  });
});

describe('seasonName', () => {
  it('flips the seasons across the equator', () => {
    assert.equal(seasonName('june-solstice', 51.5), 'Summer solstice');
    assert.equal(seasonName('june-solstice', -33.9), 'Winter solstice');
    assert.equal(seasonName('december-solstice', -33.9), 'Summer solstice');
    assert.equal(seasonName('march-equinox', -33.9), 'Autumn equinox');
  });
});

describe('bracketingSolstices', () => {
  it('reaches backwards rather than a year forwards in late December', () => {
    const { december } = bracketingSolstices(new Date('2026-12-28T00:00:00Z'));
    assert.equal(december.getUTCFullYear(), 2026);
    assert.ok(december.getTime() < Date.UTC(2026, 11, 28));
  });

  it('picks the nearest June solstice from either side of the year', () => {
    assert.equal(bracketingSolstices(new Date('2026-02-01T00:00:00Z')).june.getUTCFullYear(), 2026);
    assert.equal(bracketingSolstices(new Date('2026-11-01T00:00:00Z')).june.getUTCFullYear(), 2026);
    assert.equal(bracketingSolstices(new Date('2027-01-10T00:00:00Z')).june.getUTCFullYear(), 2027);
  });

  it('never returns a solstice more than seven months away', () => {
    for (let month = 0; month < 12; month++) {
      const date = new Date(Date.UTC(2026, month, 15));
      const { june, december } = bracketingSolstices(date);
      for (const solstice of [june, december]) {
        const months = Math.abs(solstice.getTime() - date.getTime()) / (30.4 * 86_400_000);
        assert.ok(months <= 7, `month ${month}: ${months.toFixed(1)} months away`);
      }
    }
  });
});

describe('nextSeasonEvent', () => {
  it('crosses the new year rather than looking backwards', () => {
    const next = nextSeasonEvent(new Date('2026-12-30T00:00:00Z'));
    assert.equal(next.key, 'march-equinox');
    assert.equal(next.date.getUTCFullYear(), 2027);
    assert.ok(next.inDays > 0 && next.inDays < 95, `${next.inDays} days`);
  });

  it('always looks forwards', () => {
    for (let month = 0; month < 12; month++) {
      const from = new Date(Date.UTC(2026, month, 5));
      const next = nextSeasonEvent(from);
      assert.ok(next.date.getTime() > from.getTime(), `month ${month}`);
      assert.ok(next.inDays <= 95, `month ${month}: ${next.inDays} days`);
    }
  });
});
