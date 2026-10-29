import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skyChroma, skyTally, tallyLines, type StoredReading, type CheckPhoto } from './sky-check';

const SPOT = { lat: 46.0, lon: 7.75 };
const grid = (topChroma: number) => [...Array.from({ length: 4 }, () => [0.6, topChroma, 0]).flat(), ...new Array(36).fill(0)];
const at = (iso: string) => Date.parse(iso);
const r = (iso: string, verdict: StoredReading['verdict']): StoredReading => ({ iso: iso.slice(0, 10), event: 'sunset', when: at(iso), verdict, note: '' });
const ph = (id: string, iso: string, chroma: number, dLat = 0): CheckPhoto => ({ id, lat: SPOT.lat + dLat, lon: SPOT.lon, takenAt: at(iso), colourGrid: grid(chroma) });

test('skyChroma reads the top row, and only warm or magenta colour', () => {
  assert.ok(Math.abs(skyChroma(grid(0.08))! - 0.08) < 1e-9); // hue 0: red
  const blue = [...Array.from({ length: 4 }, () => [0.7, -0.02, -0.1]).flat(), ...new Array(36).fill(0)];
  assert.equal(skyChroma(blue), 0, 'a clear blue sky is not a lit one');
  assert.equal(skyChroma([]), null);
});

test('skyTally: matches by place and time, counts what was right', () => {
  const readings = [r('2026-10-01T17:00:00Z', 'lit'), r('2026-10-02T17:00:00Z', 'lit'), r('2026-10-03T17:00:00Z', 'blocked'), r('2026-10-04T17:00:00Z', 'lit')];
  const photos = [
    ph('a', '2026-10-01T17:10:00Z', 0.09),            // lit, and it was
    ph('b', '2026-10-02T16:40:00Z', 0.01),            // lit, but plain
    ph('c', '2026-10-03T17:05:00Z', 0.02),            // blocked, plain: right
    ph('d', '2026-10-04T17:00:00Z', 0.09, 0.05),      // 5 km away: not this spot
    ph('e', '2026-10-01T19:00:00Z', 0.09),            // two hours late: not that evening
  ];
  const t = skyTally(SPOT, readings, photos);
  assert.deepEqual(t.said, { lit: 2, bare: 0, blocked: 1 });
  assert.deepEqual(t.were, { lit: 1, bare: 0, blocked: 1 });
  assert.deepEqual(t.evenings.map((e) => [e.reading.iso, e.photoIds, e.right]), [['2026-10-03', ['c'], true], ['2026-10-02', ['b'], false], ['2026-10-01', ['a'], true]]);
  assert.deepEqual(tallyLines(t), ['Scout said lit twice; 1 was.', 'Scout said blocked once; no colour came, as said.']);
});

test('tallyLines in plain words, no percentages', () => {
  const t = { said: { lit: 9, bare: 2, blocked: 0 }, were: { lit: 7, bare: 1, blocked: 0 }, evenings: [] };
  assert.deepEqual(tallyLines(t), ['Scout said lit 9 times; 7 were.', 'Scout said bare twice; 1 had colour anyway.']);
});

test('a segmented sky wins over the grid; no sky in the frame casts no vote', () => {
  const reading = r('2026-10-01T17:00:00Z', 'lit');
  const roofTop = { ...ph('a', '2026-10-01T17:00:00Z', 0.09), sky: 0.01 }; // red roof in the top row, plain sky
  assert.equal(skyTally(SPOT, [reading], [roofTop]).evenings[0].sky, 'plain');
  const noSky = { ...ph('b', '2026-10-01T17:00:00Z', 0.09), sky: null };
  assert.equal(skyTally(SPOT, [reading], [noSky]).evenings.length, 0);
});
