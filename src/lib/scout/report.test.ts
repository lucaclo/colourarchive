import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { shootPlan } from './report.ts';
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
