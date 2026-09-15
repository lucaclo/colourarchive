import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildIcs, type IcsEvent } from './ics.ts';

/** Splits a built calendar into its physical lines, the way a real parser
 *  would see them — CRLF is the separator RFC 5545 requires, not just LF. */
function lines(ics: string): string[] {
  assert.ok(ics.endsWith('\r\n'), 'file does not end with the required CRLF');
  return ics.slice(0, -2).split('\r\n');
}

const fixture: IcsEvent = {
  uid: 'scout-align-sun-2680-1758654240000@colour-archive.local',
  at: new Date('2025-09-23T18:04:00.000Z'),
  summary: 'Sun sets behind the target — Calton Hill',
  description: '0.3° off. On 268° — the skyline stands 3.1° up.',
  location: 'Calton Hill',
};

describe('buildIcs', () => {
  it('wraps every event between VCALENDAR/VEVENT boundaries', () => {
    const out = lines(buildIcs([fixture]));
    assert.equal(out[0], 'BEGIN:VCALENDAR');
    assert.equal(out.at(-1), 'END:VCALENDAR');
    assert.ok(out.includes('BEGIN:VEVENT'));
    assert.ok(out.includes('END:VEVENT'));
  });

  it('states VERSION 2.0 and a PRODID, the two fields every reader requires', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes('VERSION:2.0'));
    assert.ok(out.some((l) => l.startsWith('PRODID:')));
  });

  it('writes DTSTART as UTC, regardless of what zone the instant is read in', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes('DTSTART:20250923T180400Z'));
  });

  it('gives every event a DTEND, 30 minutes after DTSTART by default', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes('DTEND:20250923T183400Z'));
  });

  it('honours a custom duration', () => {
    const out = lines(buildIcs([{ ...fixture, durationMinutes: 90 }]));
    assert.ok(out.includes('DTEND:20250923T193400Z'));
  });

  it('carries the summary, location and (when given) description', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes('SUMMARY:Sun sets behind the target — Calton Hill'));
    assert.ok(out.includes('LOCATION:Calton Hill'));
    assert.ok(out.some((l) => l.startsWith('DESCRIPTION:') && l.includes('0.3° off')));
  });

  it('omits DESCRIPTION and LOCATION lines when neither is given', () => {
    // alarmMinutesBefore: 0 — the alarm's own DESCRIPTION (RFC 5545 requires
    // one on a DISPLAY action) is a separate concern from the VEVENT's.
    const minimal: IcsEvent = { uid: fixture.uid, at: fixture.at, summary: fixture.summary, alarmMinutesBefore: 0 };
    const out = lines(buildIcs([minimal]));
    assert.ok(!out.some((l) => l.startsWith('DESCRIPTION')));
    assert.ok(!out.some((l) => l.startsWith('LOCATION')));
  });

  it('adds a 60-minute-before reminder alarm by default', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes('BEGIN:VALARM'));
    assert.ok(out.includes('ACTION:DISPLAY'));
    assert.ok(out.includes('TRIGGER:-PT60M'));
    assert.ok(out.includes('END:VALARM'));
  });

  it('honours a custom alarm offset', () => {
    const out = lines(buildIcs([{ ...fixture, alarmMinutesBefore: 15 }]));
    assert.ok(out.includes('TRIGGER:-PT15M'));
  });

  it('omits the alarm entirely when alarmMinutesBefore is 0', () => {
    const out = lines(buildIcs([{ ...fixture, alarmMinutesBefore: 0 }]));
    assert.ok(!out.includes('BEGIN:VALARM'));
  });

  it('escapes commas, semicolons and backslashes in text values', () => {
    const out = lines(
      buildIcs([{ ...fixture, summary: 'Sun; behind, the "ridge" \\ edge' }]),
    );
    assert.ok(out.includes('SUMMARY:Sun\\; behind\\, the "ridge" \\\\ edge'));
  });

  it('escapes an embedded newline as the literal two characters \\n', () => {
    const out = lines(buildIcs([{ ...fixture, description: 'Line one\nLine two' }]));
    assert.ok(out.some((l) => l === 'DESCRIPTION:Line one\\nLine two'));
  });

  it('folds a content line longer than 75 octets onto a continuation line', () => {
    const longSummary = 'Sun sets behind the target — '.repeat(4);
    const out = lines(buildIcs([{ ...fixture, summary: longSummary }]));
    const summaryLine = out.findIndex((l) => l.startsWith('SUMMARY:'));
    assert.ok(out[summaryLine].length <= 75);
    // A folded continuation always starts with the single leading space
    // RFC 5545 requires, so a naive line-by-line reader can still tell it
    // apart from the next property.
    assert.ok(out[summaryLine + 1].startsWith(' '));
  });

  it('does not fold a line at or under 75 octets', () => {
    const out = lines(buildIcs([fixture]));
    const summaryLine = out.find((l) => l.startsWith('SUMMARY:'))!;
    assert.ok(summaryLine.length <= 75);
    const idx = out.indexOf(summaryLine);
    assert.ok(!out[idx + 1].startsWith(' '));
  });

  it('writes one VEVENT per event, in the order given', () => {
    const second: IcsEvent = { ...fixture, uid: 'second@colour-archive.local', summary: 'Second' };
    const out = lines(buildIcs([fixture, second]));
    assert.equal(out.filter((l) => l === 'BEGIN:VEVENT').length, 2);
    const firstSummaryIdx = out.indexOf(`SUMMARY:${fixture.summary}`);
    const secondSummaryIdx = out.indexOf('SUMMARY:Second');
    assert.ok(firstSummaryIdx < secondSummaryIdx);
  });

  it('writes an empty calendar (no events) as valid, matched boundaries', () => {
    const out = lines(buildIcs([]));
    assert.deepEqual(out, ['BEGIN:VCALENDAR', 'VERSION:2.0', out[2], 'CALSCALE:GREGORIAN', 'END:VCALENDAR']);
  });

  it('adds X-WR-CALNAME only when a calendar name is given', () => {
    const named = lines(buildIcs([fixture], { calendarName: 'Calton Hill — Scout alignments' }));
    assert.ok(named.some((l) => l.startsWith('X-WR-CALNAME:')));
    const unnamed = lines(buildIcs([fixture]));
    assert.ok(!unnamed.some((l) => l.startsWith('X-WR-CALNAME')));
  });

  it('each UID is written back out verbatim (escaped), for stable re-import dedup', () => {
    const out = lines(buildIcs([fixture]));
    assert.ok(out.includes(`UID:${fixture.uid}`));
  });
});
