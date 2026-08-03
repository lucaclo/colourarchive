import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MINUTES_PER_DAY,
  PHASE_COLOUR,
  altitudeColour,
  daySegments,
  describeLightWindows,
  describeNextChange,
  formatClock,
  formatDayLabel,
  formatDuration,
  formatMinute,
  formatShadowRatio,
  formatZoneAbbreviation,
  isoDateIn,
  scoutDay,
  shadeOverlayGradient,
  shiftIsoDate,
  skyTrackGradient,
  sunEventRows,
  trackGradient,
  twilightRows,
  zonedNoon,
} from './daylight.ts';
import { phaseForAltitude, type SunPhase, type SunSample } from './sun.ts';

const utc = (y: number, m: number, d: number, h = 12) => new Date(Date.UTC(y, m - 1, d, h));

const LONDON = { lat: 51.5074, lon: -0.1278, tz: 'Europe/London' };
const TOKYO = { lat: 35.6762, lon: 139.6503, tz: 'Asia/Tokyo' };
const TROMSO = { lat: 69.6496, lon: 18.956, tz: 'Europe/Oslo' };

/** A minimal fake sample — only `phase` matters to the segmenter. */
const fake = (phases: SunPhase[]): SunSample[] =>
  phases.map((phase) => ({ phase }) as SunSample);

describe('daySegments', () => {
  it('collapses runs of the same phase', () => {
    const segments = daySegments(fake(['night', 'night', 'night', 'blue', 'blue', 'day']));
    assert.deepEqual(segments, [
      { phase: 'night', startMinute: 0, endMinute: 3 },
      { phase: 'blue', startMinute: 3, endMinute: 5 },
      { phase: 'day', startMinute: 5, endMinute: 6 },
    ]);
  });

  it('covers the whole span with no gaps and no overlaps', () => {
    const segments = daySegments(fake(['night', 'blue', 'blue', 'golden', 'day', 'day', 'night']));
    assert.equal(segments[0].startMinute, 0);
    assert.equal(segments.at(-1)!.endMinute, 7);
    for (let i = 1; i < segments.length; i++) {
      assert.equal(segments[i].startMinute, segments[i - 1].endMinute, `gap at ${i}`);
    }
  });

  it('handles a day that never changes phase', () => {
    const segments = daySegments(fake(Array(50).fill('day')));
    assert.deepEqual(segments, [{ phase: 'day', startMinute: 0, endMinute: 50 }]);
  });

  it('returns nothing for no samples', () => {
    assert.deepEqual(daySegments([]), []);
  });
});

describe('trackGradient', () => {
  it('emits hard stops so bands do not smear into each other', () => {
    // Each segment contributes its colour twice — once where it starts and once
    // where it ends — which is what makes the boundary a step, not a blend.
    const gradient = trackGradient(
      [
        { phase: 'night', startMinute: 0, endMinute: 720 },
        { phase: 'day', startMinute: 720, endMinute: 1440 },
      ],
      1440,
    );
    assert.ok(gradient.startsWith('linear-gradient(to right, '));
    assert.ok(gradient.includes(`${PHASE_COLOUR.night} 0.000%`));
    assert.ok(gradient.includes(`${PHASE_COLOUR.night} 50.000%`));
    assert.ok(gradient.includes(`${PHASE_COLOUR.day} 50.000%`));
    assert.ok(gradient.includes(`${PHASE_COLOUR.day} 100.000%`));
  });

  it('falls back to a flat colour with nothing to draw', () => {
    assert.equal(trackGradient([]), PHASE_COLOUR.night);
  });

  it('produces two stops per segment of a real day', () => {
    const day = scoutDay(LONDON.lat, LONDON.lon, utc(2026, 7, 31));
    // Built from the segments directly: `day.gradient` is the continuous track
    // now, and this test is about the banded one.
    const inner = trackGradient(day.segments).slice('linear-gradient('.length, -1);
    const parts = inner.split(', ');
    assert.equal(parts[0], 'to right');
    assert.equal(parts.length - 1, day.segments.length * 2);
    // And it spans the full width, edge to edge.
    assert.ok(parts[1].endsWith(' 0.000%'), parts[1]);
    assert.ok(parts[parts.length - 1].endsWith(' 100.000%'), parts[parts.length - 1]);
  });
});

describe('scoutDay', () => {
  it('samples a full day, minute by minute', () => {
    const day = scoutDay(LONDON.lat, LONDON.lon, utc(2026, 7, 31));
    assert.equal(day.samples.length, MINUTES_PER_DAY + 1);
    assert.equal(day.samples[0].date.getTime(), day.times.dayStart.getTime());
    assert.equal(
      day.samples.at(-1)!.date.getTime() - day.samples[0].date.getTime(),
      MINUTES_PER_DAY * 60_000,
    );
  });

  it('agrees with the phase of every sample it segmented', () => {
    const day = scoutDay(TOKYO.lat, TOKYO.lon, utc(2026, 7, 31));
    for (const segment of day.segments) {
      for (let i = segment.startMinute; i < segment.endMinute; i++) {
        assert.equal(
          phaseForAltitude(day.samples[i].altitude),
          segment.phase,
          `minute ${i}`,
        );
      }
    }
  });

  it('puts a London summer day in a sensible order', () => {
    const day = scoutDay(LONDON.lat, LONDON.lon, utc(2026, 7, 31));
    const phases = day.segments.map((s) => s.phase);
    // Starts and ends in the dark, peaks in daylight, and passes through both
    // blue and golden on the way in and out.
    assert.equal(phases[0], day.segments.at(-1)!.phase);
    assert.ok(phases.includes('day'));
    assert.equal(phases.filter((p) => p === 'golden').length, 2);
    assert.equal(phases.filter((p) => p === 'blue').length, 2);
  });

  it('describes the midnight sun without inventing a night', () => {
    const day = scoutDay(TROMSO.lat, TROMSO.lon, utc(2026, 6, 21));
    assert.equal(day.times.polar, 'midnight-sun');
    const phases = new Set(day.segments.map((s) => s.phase));
    assert.ok(!phases.has('night'), [...phases].join(','));
    assert.ok(!phases.has('nautical'), [...phases].join(','));
  });

  it('describes the polar night without inventing a day', () => {
    const day = scoutDay(TROMSO.lat, TROMSO.lon, utc(2026, 12, 21));
    assert.equal(day.times.polar, 'polar-night');
    const phases = new Set(day.segments.map((s) => s.phase));
    assert.ok(!phases.has('day'), [...phases].join(','));
  });
});

describe('formatting', () => {
  it('reads the clock where the photograph is, not where the reader is', () => {
    // 2026-07-31T09:46Z is 18:46 in Tokyo and 10:46 in London. The same instant
    // must print differently for the two places — this is the whole point.
    const instant = new Date('2026-07-31T09:46:00Z');
    assert.equal(formatClock(instant, TOKYO.tz), '18:46');
    assert.equal(formatClock(instant, LONDON.tz), '10:46');
    assert.equal(formatClock(instant, 'UTC'), '09:46');
  });

  it('applies daylight saving from the zone name, not a frozen offset', () => {
    const summer = new Date('2026-07-31T12:00:00Z');
    const winter = new Date('2026-12-31T12:00:00Z');
    assert.equal(formatClock(summer, LONDON.tz), '13:00'); // BST
    assert.equal(formatClock(winter, LONDON.tz), '12:00'); // GMT
    // Tokyo has never observed DST, so it must not move.
    assert.equal(formatClock(summer, TOKYO.tz), '21:00');
    assert.equal(formatClock(winter, TOKYO.tz), '21:00');
  });

  it('falls back to UTC rather than throwing on a bad zone', () => {
    assert.equal(formatClock(new Date('2026-07-31T09:46:00Z'), 'Nowhere/Nothing'), '09:46');
    assert.equal(formatZoneAbbreviation(new Date(), 'Nowhere/Nothing'), '');
  });

  it('names the offset', () => {
    const summer = new Date('2026-07-31T12:00:00Z');
    assert.equal(formatZoneAbbreviation(summer, TOKYO.tz), 'GMT+9');
    assert.equal(formatZoneAbbreviation(summer, LONDON.tz), 'GMT+1');
  });

  it('writes durations a person can act on', () => {
    assert.equal(formatDuration(0), '0 m');
    assert.equal(formatDuration(48), '48 m');
    assert.equal(formatDuration(59.6), '1 h');
    assert.equal(formatDuration(60), '1 h');
    assert.equal(formatDuration(134), '2 h 14 m');
    assert.equal(formatDuration(-5), '0 m');
  });
});

describe('dates where the place is', () => {
  it('reads the calendar date at the place, not at the reader', () => {
    // 23:30 UTC on the 30th is already the 31st in Tokyo and still the 30th in
    // London. Offering the wrong one would silently plan the wrong day.
    const instant = new Date(Date.UTC(2026, 6, 30, 23, 30));
    assert.equal(isoDateIn(instant, TOKYO.tz), '2026-07-31');
    assert.equal(isoDateIn(instant, LONDON.tz), '2026-07-31'); // BST is UTC+1
    assert.equal(isoDateIn(instant, 'UTC'), '2026-07-30');
  });

  it('survives a timezone it has never heard of', () => {
    assert.equal(isoDateIn(new Date(Date.UTC(2026, 0, 2, 6)), 'Mars/Olympus'), '2026-01-02');
  });

  it('lands midday on the date that was asked for, anywhere', () => {
    for (const zone of [LONDON.tz, TOKYO.tz, 'America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      for (const date of ['2026-01-15', '2026-07-04', '2026-12-31']) {
        const instant = zonedNoon(date, zone);
        assert.equal(isoDateIn(instant, zone), date, `${zone} ${date}`);
        const hour = Number(
          new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }).format(
            instant,
          ),
        );
        assert.equal(hour, 12, `${zone} ${date} landed at ${hour}`);
      }
    }
  });

  it('lands midday across a daylight-saving change too', () => {
    // The UK springs forward on 2026-03-29 and falls back on 2026-10-25.
    for (const date of ['2026-03-28', '2026-03-29', '2026-03-30', '2026-10-25', '2026-10-26']) {
      assert.equal(isoDateIn(zonedNoon(date, LONDON.tz), LONDON.tz), date);
    }
  });

  it('refuses to invent a date out of nonsense', () => {
    assert.ok(Number.isNaN(zonedNoon('not-a-date', LONDON.tz).getTime()));
    assert.equal(shiftIsoDate('not-a-date', 1), 'not-a-date');
  });

  it('steps whole days, including over month and year ends', () => {
    assert.equal(shiftIsoDate('2026-07-31', 1), '2026-08-01');
    assert.equal(shiftIsoDate('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftIsoDate('2028-02-28', 1), '2028-02-29');
    assert.equal(shiftIsoDate('2026-07-31', 0), '2026-07-31');
  });

  it('gives a date a person reads', () => {
    assert.equal(formatDayLabel('2026-07-31', LONDON.tz), 'Fri 31 Jul');
    assert.equal(formatDayLabel('rubbish', LONDON.tz), 'rubbish');
  });

  it('drives the sun engine to a different day', () => {
    const june = scoutDay(LONDON.lat, LONDON.lon, zonedNoon('2026-06-21', LONDON.tz));
    const december = scoutDay(LONDON.lat, LONDON.lon, zonedNoon('2026-12-21', LONDON.tz));
    const length = (d: typeof june) =>
      (d.times.sunset!.getTime() - d.times.sunrise!.getTime()) / 60_000;
    // London: about 16h39m at the solstice against 7h50m at the other one.
    assert.ok(length(june) > 980, `${length(june)}`);
    assert.ok(length(december) < 490, `${length(december)}`);
  });
});

describe('sunEventRows', () => {
  const rows = (lat: number, lon: number, date: Date) => sunEventRows(scoutDay(lat, lon, date).times);
  const byKey = (list: ReturnType<typeof sunEventRows>, key: string) =>
    list.find((r) => r.key === key)!;

  it('lists the day in the order it happens', () => {
    const list = rows(LONDON.lat, LONDON.lon, utc(2026, 6, 15));
    assert.deepEqual(
      list.map((r) => r.key),
      [
        'civilDawn',
        'blueMorning',
        'sunrise',
        'goldenMorning',
        'solarNoon',
        'goldenEvening',
        'sunset',
        'blueEvening',
        'civilDusk',
      ],
    );
    // Reading order, not a chronological sort: golden hour opens *before*
    // sunrise and closes *after* sunset, and listing it that way is what the
    // photographer means by "golden hour". What must hold is that the fixed
    // points march forward and each golden window brackets its own event.
    const at = (key: string) => byKey(list, key).start!.getTime();
    assert.ok(at('civilDawn') <= at('sunrise'));
    assert.ok(at('sunrise') <= at('solarNoon'));
    assert.ok(at('solarNoon') <= at('sunset'));
    assert.ok(at('sunset') <= at('civilDusk'));
    assert.ok(at('goldenMorning') <= at('sunrise'));
    assert.ok(byKey(list, 'goldenMorning').end!.getTime() >= at('sunrise'));
    assert.ok(at('goldenEvening') <= at('sunset'));
    assert.ok(byKey(list, 'goldenEvening').end!.getTime() >= at('sunset'));
  });

  it('puts the morning windows before noon and the evening ones after', () => {
    const list = rows(LONDON.lat, LONDON.lon, utc(2026, 6, 15));
    const noon = byKey(list, 'solarNoon').start!.getTime();
    assert.ok(byKey(list, 'goldenMorning').end!.getTime() <= noon);
    assert.ok(byKey(list, 'goldenEvening').start!.getTime() >= noon);
    assert.ok(byKey(list, 'blueMorning').end!.getTime() <= noon);
    assert.ok(byKey(list, 'blueEvening').start!.getTime() >= noon);
  });

  it('gives the windows both ends and the instants only one', () => {
    const list = rows(LONDON.lat, LONDON.lon, utc(2026, 6, 15));
    for (const key of ['goldenMorning', 'goldenEvening', 'blueMorning', 'blueEvening']) {
      const row = byKey(list, key);
      assert.ok(row.start && row.end, key);
      assert.ok(row.end!.getTime() > row.start!.getTime(), key);
    }
    assert.equal(byKey(list, 'sunrise').end ?? null, null);
  });

  it('keeps every row on a midnight-sun day, and invents no sunrise', () => {
    const list = rows(TROMSO.lat, TROMSO.lon, utc(2026, 6, 21));
    assert.equal(list.length, 9);
    // The sun never sets in Tromsø in June: the row is present and empty rather
    // than dropped, so the absence is visible.
    assert.equal(byKey(list, 'sunset').start, null);
    assert.equal(byKey(list, 'civilDusk').start, null);
  });

  it('never repeats one unbroken band as both morning and evening', () => {
    for (const date of [utc(2026, 6, 21), utc(2026, 7, 25), utc(2026, 12, 21), utc(2026, 1, 15)]) {
      const list = rows(TROMSO.lat, TROMSO.lon, date);
      const morning = byKey(list, 'goldenMorning');
      const evening = byKey(list, 'goldenEvening');
      if (morning.start && evening.start) {
        assert.notEqual(
          morning.start.getTime(),
          evening.start.getTime(),
          `${date.toISOString()} listed the same golden hour twice`,
        );
      }
    }
  });

  it('keeps a polar-night day listable', () => {
    const list = rows(TROMSO.lat, TROMSO.lon, utc(2026, 12, 21));
    assert.equal(list.length, 9);
    assert.equal(byKey(list, 'sunrise').start, null);
    assert.ok(byKey(list, 'solarNoon').start);
  });
});

describe('shadeOverlayGradient', () => {
  const w = (lit: boolean, belowHorizon: boolean, startMinute: number, endMinute: number) => ({
    lit,
    belowHorizon,
    startMinute,
    endMinute,
  });

  it('masks daytime shade and leaves night alone', () => {
    const css = shadeOverlayGradient(
      [w(false, true, 0, 300), w(true, false, 300, 600), w(false, false, 600, 700), w(true, false, 700, 1440)],
      1440,
    );
    // The night run must not appear as a mask; the 600-700 shade must.
    assert.ok(css.includes('41.667%'), css);
    assert.ok(css.includes('48.611%'), css);
    assert.ok(css.startsWith('linear-gradient(to right, transparent 0.000%'), css);
  });

  it('is fully transparent for a spot that is never shaded in daylight', () => {
    const css = shadeOverlayGradient([w(false, true, 0, 300), w(true, false, 300, 1440)], 1440);
    assert.equal(css, 'linear-gradient(to right, transparent, transparent)');
  });

  it('uses hard stops so a short window does not smear away', () => {
    const css = shadeOverlayGradient([w(false, false, 100, 110), w(true, false, 110, 1440)], 1440);
    const stops = css.match(/[\d.]+%/g)!;
    // Each band contributes a pair of identical positions — that is what makes
    // it a band rather than a fade.
    assert.ok(stops.length >= 4, css);
  });
});

describe('formatShadowRatio', () => {
  it('quotes the ratio a sun app quotes', () => {
    assert.equal(formatShadowRatio(45), '1 : 1.00');
    assert.equal(formatShadowRatio(30), '1 : 1.73');
    assert.equal(formatShadowRatio(63.435), '1 : 0.50');
  });

  it('drops to one decimal once the shadow is long', () => {
    assert.equal(formatShadowRatio(5), '1 : 11.4');
  });

  it('refuses to print false precision at the horizon', () => {
    assert.equal(formatShadowRatio(0.1), '1 : 99+');
    assert.equal(formatShadowRatio(0), '—');
    assert.equal(formatShadowRatio(-6), '—');
  });
});

describe('twilightRows', () => {
  it('lists the bands in the order the evening goes', () => {
    const times = scoutDay(51.5, -0.12, new Date('2026-07-31T12:00:00Z')).times;
    const rows = twilightRows(times);
    assert.deepEqual(
      rows.map((r) => r.key),
      ['astronomicalDawn', 'nauticalDawn', 'nauticalDusk', 'astronomicalDusk'],
    );
    assert.ok(rows[0].start && rows[1].start && rows[0].start < rows[1].start);
  });

  it('keeps a row with no time rather than dropping it', () => {
    // Midsummer at Tromsø: the sun never gets down to −18°, so there is no
    // astronomical twilight at all — and saying so is the answer.
    const times = scoutDay(69.65, 18.96, new Date('2026-06-21T12:00:00Z')).times;
    const rows = twilightRows(times);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].start, null);
  });
});

describe('formatMinute', () => {
  it('reads a minute index as a clock where the place is', () => {
    const dayStart = new Date('2026-07-31T00:00:00Z');
    assert.equal(formatMinute(dayStart, 0, 'UTC'), '00:00');
    assert.equal(formatMinute(dayStart, 754, 'UTC'), '12:34');
    assert.equal(formatMinute(dayStart, 754, 'Asia/Tokyo'), '21:34');
  });
});

describe('describeLightWindows', () => {
  const dayStart = new Date('2026-07-31T00:00:00Z');
  const window = (lit: boolean, startMinute: number, endMinute: number, belowHorizon = false) => ({
    lit,
    startMinute,
    endMinute,
    belowHorizon,
  });

  it('says when the sun is on the spot, and for how long in total', () => {
    const text = describeLightWindows(
      [window(false, 0, 400, true), window(true, 400, 552), window(false, 552, 1440)],
      dayStart,
      'UTC',
    );
    assert.match(text, /06:40–09:12/);
    assert.match(text, /2 h 32 m in all/);
  });

  it('joins two spells with an “and”', () => {
    const text = describeLightWindows(
      [window(true, 400, 552), window(false, 552, 990), window(true, 990, 1184)],
      dayStart,
      'UTC',
    );
    assert.match(text, /06:40–09:12 and 16:30–19:44/);
  });

  it('counts the spells rather than listing a colonnade of them', () => {
    const windows = [];
    for (let i = 0; i < 6; i++) {
      windows.push(window(true, 400 + i * 60, 420 + i * 60));
      windows.push(window(false, 420 + i * 60, 460 + i * 60));
    }
    const text = describeLightWindows(windows, dayStart, 'UTC');
    assert.match(text, /6 spells/);
    assert.match(text, /first 06:40/);
  });

  it('says plainly when a spot never sees the sun', () => {
    const text = describeLightWindows([window(false, 0, 1440)], dayStart, 'UTC');
    assert.equal(text, 'No direct sun here today.');
    assert.equal(describeLightWindows([], dayStart, 'UTC'), 'No direct sun here today.');
  });
});

describe('describeNextChange', () => {
  const dayStart = new Date('2026-07-31T00:00:00Z');

  it('counts down to the light arriving', () => {
    const text = describeNextChange({ lit: true, atMinute: 1120, inMinutes: 24 }, dayStart, 'UTC');
    assert.equal(text, 'Lit in 24 m, at 18:40.');
  });

  it('counts down to losing it', () => {
    const text = describeNextChange({ lit: false, atMinute: 1212, inMinutes: 116 }, dayStart, 'UTC');
    assert.equal(text, 'In shadow in 1 h 56 m, at 20:12.');
  });

  it('says nothing when there is no next change', () => {
    assert.equal(describeNextChange(null, dayStart, 'UTC'), '');
    assert.equal(describeNextChange({ lit: true, atMinute: 10, inMinutes: 0 }, dayStart, 'UTC'), '');
  });
});

describe('altitudeColour', () => {
  it('lands on each band’s own colour at that band’s centre', () => {
    assert.equal(altitudeColour(-15), PHASE_COLOUR.astronomical);
    assert.equal(altitudeColour(-9), PHASE_COLOUR.nautical);
    assert.equal(altitudeColour(-5), PHASE_COLOUR.blue);
    assert.equal(altitudeColour(1), PHASE_COLOUR.golden);
    assert.equal(altitudeColour(12), PHASE_COLOUR.day);
  });

  it('clamps rather than running off either end', () => {
    assert.equal(altitudeColour(-90), PHASE_COLOUR.night);
    assert.equal(altitudeColour(89), PHASE_COLOUR.day);
  });

  it('moves continuously, with no jumps between bands', () => {
    let previous = altitudeColour(-30);
    for (let altitude = -30; altitude <= 30; altitude += 0.5) {
      const colour = altitudeColour(altitude);
      const a = [1, 3, 5].map((i) => parseInt(previous.slice(i, i + 2), 16));
      const b = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
      const jump = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      // Blue hour to golden hour is the steepest stretch of the ramp — six
      // degrees carrying the whole way from #2f5286 to #c1863c, about twelve
      // levels per half-degree. A hard band boundary would show here as a jump
      // of well over a hundred.
      assert.ok(jump <= 13, `${altitude}°: jumped ${jump}`);
      previous = colour;
    }
  });

  it('is a well-formed colour at every altitude', () => {
    for (let altitude = -90; altitude <= 90; altitude += 1) {
      assert.match(altitudeColour(altitude), /^#[0-9a-f]{6}$/, `${altitude}`);
    }
  });
});

describe('skyTrackGradient', () => {
  const day = scoutDay(51.5074, -0.1278, new Date('2026-07-31T12:00:00Z'));

  it('is a gradient that starts dark, brightens and darkens again', () => {
    const gradient = skyTrackGradient(day.samples);
    assert.match(gradient, /^linear-gradient\(to right, /);
    assert.match(gradient, /100%\)$/);
    const colours = [...gradient.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
    const brightness = (hex: string) =>
      [1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
    const peak = colours.reduce((best, c) => (brightness(c) > brightness(best) ? c : best));
    assert.ok(brightness(colours[0]) < brightness(peak));
    assert.ok(brightness(colours[colours.length - 1]) < brightness(peak));
  });

  it('passes through blue hour’s colour, which banding was meant to protect', () => {
    // The original worry was that interpolating between six fixed stops would
    // smear an eleven-minute band into nothing. Sampling the sun instead is what
    // makes this hold — the track reaches each band's colour because the sun
    // reaches that band's altitude, however briefly.
    //
    // "Reaches" rather than "contains exactly": a two-minute sample seldom lands
    // on precisely −5.0°, so the nearest stop is what is asked for.
    const colours = [...skyTrackGradient(day.samples).matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]);
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const nearest = (target: string) =>
      Math.min(
        ...colours.map((c) =>
          Math.max(...channels(c).map((v, i) => Math.abs(v - channels(target)[i]))),
        ),
      );
    assert.ok(nearest(PHASE_COLOUR.blue) < 20, `blue hour off by ${nearest(PHASE_COLOUR.blue)}`);
    assert.ok(nearest(PHASE_COLOUR.golden) < 20, `golden hour off by ${nearest(PHASE_COLOUR.golden)}`);
  });

  it('keeps the string to a sane size', () => {
    const gradient = skyTrackGradient(day.samples);
    assert.ok(gradient.length < 8000, `${gradient.length} characters`);
    assert.ok(gradient.length > 200, 'and not so few stops that it is a smear');
  });

  it('holds up where the sun barely moves', () => {
    // Polar night: no crossings at all, so every sample is one colour and the
    // gradient collapses to its two ends rather than to nothing.
    const polar = scoutDay(78.2, 15.6, new Date('2026-12-21T12:00:00Z'));
    const gradient = skyTrackGradient(polar.samples);
    assert.ok(gradient.length > 0);
    assert.doesNotMatch(gradient, /NaN|undefined/);
  });

  it('says something rather than nothing when handed nothing', () => {
    assert.equal(skyTrackGradient([]), PHASE_COLOUR.night);
  });
});
