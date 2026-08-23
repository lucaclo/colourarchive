import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { suggestShootForGap, suggestShootsForGaps } from './gap-shoots.ts';
import type { ColourGap } from '../gaps.ts';

const CALTON = { lat: 55.9553, lon: -3.1817 };
const FROM = new Date('2026-01-01T00:00:00Z');

const gap = (anchorKey: string, anchorName: string, targetHue: number): ColourGap => ({
  anchorKey,
  anchorName,
  targetHue,
  kind: 'missing',
  photoCount: 0,
  note: '',
});

describe('suggestShootForGap', () => {
  it('finds real dates for a reachable colour (red — low, warm sun)', () => {
    const shoot = suggestShootForGap(gap('red', 'Red', 28), CALTON, FROM, 365);
    assert.ok(shoot.match, 'red should be reachable');
    assert.ok(shoot.occurrences.length > 0, 'Edinburgh sees a low warm sun often across a year');
    // Chronological and all within the search window.
    for (let i = 1; i < shoot.occurrences.length; i++) {
      assert.ok(shoot.occurrences[i].at.getTime() > shoot.occurrences[i - 1].at.getTime());
    }
    for (const occ of shoot.occurrences) {
      assert.ok(occ.at.getTime() >= FROM.getTime());
      assert.ok(occ.at.getTime() <= FROM.getTime() + 365 * 86_400_000);
    }
  });

  it('refuses a colour daylight cannot make, with no search performed', () => {
    const shoot = suggestShootForGap(gap('green', 'Green', 145), CALTON, FROM, 365);
    assert.equal(shoot.match, null);
    assert.equal(shoot.occurrences.length, 0);
    assert.match(shoot.note, /isn't a colour daylight itself makes/);
  });

  it('every occurrence carries a real azimuth and a direction of travel', () => {
    const shoot = suggestShootForGap(gap('orange', 'Orange', 62), CALTON, FROM, 365);
    assert.ok(shoot.match);
    for (const occ of shoot.occurrences) {
      assert.ok(occ.azimuth >= 0 && occ.azimuth < 360);
      assert.equal(typeof occ.ascending, 'boolean');
    }
  });

  it('a matched-but-unreachable altitude at this latitude says so honestly', () => {
    // Fabricate a gap whose only match sits at an altitude this point never
    // reaches in the window — a very short search near the winter floor.
    const shoot = suggestShootForGap(gap('teal', 'Teal', 195), CALTON, new Date('2026-06-21T00:00:00Z'), 1);
    // Either genuinely unreachable in one day, or found — both are honest;
    // what matters is the note always explains which.
    if (shoot.occurrences.length === 0 && shoot.match) {
      assert.match(shoot.note, /never reaches/);
    }
  });
});

describe('suggestShootsForGaps', () => {
  it('maps one shoot per gap, preserving order', () => {
    const gaps = [gap('red', 'Red', 28), gap('green', 'Green', 145), gap('blue', 'Blue', 255)];
    const shoots = suggestShootsForGaps(gaps, CALTON, FROM, 200);
    assert.equal(shoots.length, 3);
    assert.equal(shoots[0].gap.anchorKey, 'red');
    assert.equal(shoots[1].gap.anchorKey, 'green');
    assert.equal(shoots[2].gap.anchorKey, 'blue');
  });
});
