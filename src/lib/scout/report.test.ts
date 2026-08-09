import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { itineraryReport, shootPlan } from './report.ts';
import type { Itinerary } from './itinerary.ts';
import type { SunEventRow } from './daylight.ts';

const at = (iso: string) => new Date(iso);

const EVENTS: SunEventRow[] = [
  { key: 'sunrise', label: 'Sunrise', icon: 'sunrise', start: at('2026-08-01T04:14:00Z') },
  {
    key: 'golden-am',
    label: 'Golden hour',
    icon: 'golden',
    start: at('2026-08-01T04:14:00Z'),
    end: at('2026-08-01T05:07:00Z'),
  },
  { key: 'noon', label: 'Solar noon', icon: 'noon', start: at('2026-08-01T12:12:00Z') },
  { key: 'sunset', label: 'Sunset', icon: 'sunset', start: null },
];

const BASE = {
  name: 'City of Edinburgh',
  centre: { lat: 55.953251, lon: -3.188267 },
  dayLabel: 'Sat 1 Aug',
  timeZone: 'Europe/London',
  events: EVENTS,
};

describe('shootPlan', () => {
  it('leads with the place, the day and the coordinates', () => {
    const lines = shootPlan(BASE).split('\n');
    assert.equal(lines[0], 'City of Edinburgh — Sat 1 Aug');
    assert.equal(lines[1], '55.95325, -3.18827');
  });

  it('prints an instant as a time and a window as a span', () => {
    // Padding is the alignment test's business, not this one's.
    const text = shootPlan(BASE);
    assert.match(text, /^Sunrise\s+05:14$/m, text);
    assert.match(text, /^Golden hour\s+05:14–06:07$/m, text);
  });

  it('lists an event the day does not have, rather than dropping the row', () => {
    // A silently missing row reads as an oversight; a dash reads as an answer.
    assert.match(shootPlan(BASE), /^Sunset\s+—$/m);
  });

  it('lines the times up, so it survives being pasted into a note', () => {
    const times = shootPlan(BASE)
      .split('\n')
      .filter((line) => /^(Sunrise|Golden hour|Solar noon|Sunset)/.test(line))
      .map((line) => line.indexOf(line.trim().split(/ {2,}/)[1]));
    assert.equal(new Set(times).size, 1, 'every time starts at the same column');
  });

  it('always says the times are local, and to where', () => {
    assert.match(shootPlan(BASE), /Times are local to Europe\/London\./);
  });

  it('never leaves without saying the shadows are modelled', () => {
    // Pasted elsewhere the plan loses every visual cue that these are inferred
    // building heights, so the text has to carry the caveat itself.
    assert.match(shootPlan(BASE), /shadows are modelled, not measured\./);
  });

  it('uses the caller’s own caveat when there is a sharper one to give', () => {
    const text = shootPlan({ ...BASE, caveat: '412 of 900 heights are storey-count guesses.' });
    assert.match(text, /shadows are modelled — 412 of 900 heights are storey-count guesses\./);
    assert.doesNotMatch(text, /not measured/);
  });

  it('carries the notes it is given and skips the ones it is not', () => {
    const text = shootPlan({
      ...BASE,
      light: 'Direct sun 07:03–18:20 · 11 h 17 m in all.',
      moment: 'Light at 04:05: no direct light — the sun is down.',
    });
    assert.match(text, /Direct sun 07:03–18:20/);
    assert.match(text, /Light at 04:05/);
    assert.doesNotMatch(text, /undefined/);
  });

  it('keeps a momentary note below the day it belongs to', () => {
    // Loose among the event rows, "the sun is down" under a sunrise time reads
    // as a contradiction rather than a remark about one minute.
    const text = shootPlan({ ...BASE, moment: 'Light at 04:05: the sun is down.' });
    const lines = text.split('\n');
    assert.ok(
      lines.findIndex((l) => l.startsWith('Light at')) >
        lines.findIndex((l) => l.startsWith('Sunset')),
      text,
    );
  });

  it('holds together with no events at all', () => {
    const text = shootPlan({ ...BASE, events: [] });
    assert.match(text, /City of Edinburgh/);
    assert.match(text, /Times are local to/);
    assert.doesNotMatch(text, /\n\n\n/, 'no gaping hole where the table was');
  });
});

/* ── The itinerary, pasted ─────────────────────────────────────────────────── */

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const spotAt = (name: string, lon: number) => ({
  name,
  at: { lat: 55.95, lon },
  windows: [{ lit: true, startMinute: 0, endMinute: 1440 }],
});

const PLAN: Itinerary = {
  stops: [
    {
      spot: spotAt('Calton Hill', -3.18),
      arriveMinute: 330,
      leaveMinute: 360,
      travelM: 0,
      travelMinutes: 0,
      bestMinute: 330,
      offBestMinutes: 0,
      sunAltitude: 4.2,
    },
    {
      spot: spotAt('Dean Village', -3.22),
      arriveMinute: 400,
      leaveMinute: 430,
      travelM: 2600,
      travelMinutes: 6,
      bestMinute: 380,
      offBestMinutes: 20,
      sunAltitude: 11.8,
    },
  ],
  dropped: [
    {
      spot: spotAt('Portobello', -3.11),
      reason: 'no-room',
      note: 'Portobello could not be reached in time from anywhere else in the day, in any order.',
    },
  ],
  conflicts: [
    { kind: 'unreachable', note: 'No ordering fits Portobello between the others.' },
  ],
  totalTravelM: 2600,
  totalTravelMinutes: 6,
  travelAssumption: 'Travel is straight-line distance at 30 km/h, plus 30 minutes at each spot.',
};

const REPORT = { dayLabel: 'Sat 8 Aug', timeZone: 'Europe/London', itinerary: PLAN, clock };

describe('itineraryReport', () => {
  it('lists every stop with its times and its sun', () => {
    const text = itineraryReport(REPORT);
    assert.match(text, /05:30–06:00/);
    assert.match(text, /Calton Hill/);
    assert.match(text, /Dean Village/);
    assert.match(text, /6 min travel/);
    assert.match(text, /sun 4°/);
  });

  it('prints what did not fit — an absent event is listed as absent', () => {
    const text = itineraryReport(REPORT);
    assert.match(text, /Left out:/);
    assert.match(text, /Portobello could not be reached/);
    assert.match(text, /Clashes:/);
  });

  it('carries the travel assumption and the same closing lines as a shoot plan', () => {
    const text = itineraryReport(REPORT);
    assert.match(text, /straight-line distance at 30 km\/h/);
    assert.match(text, /Times are local to Europe\/London\./);
    assert.match(text, /shadows are modelled, not measured\./);
  });

  it('takes the caveat the same way a shoot plan does', () => {
    const text = itineraryReport({ ...REPORT, caveat: '12 heights are guesses.' });
    assert.match(text, /shadows are modelled — 12 heights are guesses\./);
    assert.doesNotMatch(text, /not measured/);
  });

  it('says so plainly when nothing could be planned, and still closes properly', () => {
    const text = itineraryReport({
      ...REPORT,
      itinerary: { ...PLAN, stops: [], totalTravelM: 0, totalTravelMinutes: 0 },
    });
    assert.match(text, /Nothing could be planned/);
    assert.match(text, /Times are local to/);
    assert.doesNotMatch(text, /undefined/);
  });
});
