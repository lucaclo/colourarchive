import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, monthTitle, shiftMonth } from './calendar';

describe('monthGrid', () => {
  it('starts on Monday and pads with the neighbouring months as null', () => {
    // 1 October 2026 is a Thursday.
    const weeks = monthGrid('2026-10');
    assert.deepEqual(weeks[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    assert.equal(weeks.at(-1)!.filter(Boolean).at(-1), '2026-10-31');
    assert.ok(weeks.every((week) => week.length === 7));
  });
  it('handles a month that starts on a Monday and a leap February', () => {
    assert.equal(monthGrid('2027-02')[0][0], '2027-02-01');
    const leap = monthGrid('2028-02').flat().filter(Boolean);
    assert.equal(leap.length, 29);
  });
});

describe('shiftMonth', () => {
  it('crosses the year both ways', () => {
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(shiftMonth('2026-10', 0), '2026-10');
  });
});

describe('monthTitle', () => {
  it('spells the month out', () => {
    assert.equal(monthTitle('2026-10'), 'October 2026');
  });
});
