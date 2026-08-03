import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  daysInMonth,
  formatColumn,
  goldenRuns,
  gridColumns,
  monthGrid,
  monthOf,
  shiftIsoMonth,
  zonedInstant,
} from './grid.ts';
import { sunPosition } from './sun.ts';
import type { LatLon } from './geo.ts';

const EDINBURGH: LatLon = { lat: 55.9533, lon: -3.1883 };
const LONDON_ZONE = 'Europe/London';

describe('daysInMonth', () => {
  it('gets the length of a month right without a rule about leap years', () => {
    assert.equal(daysInMonth('2026-02').length, 28);
    assert.equal(daysInMonth('2028-02').length, 29);
    assert.equal(daysInMonth('2026-08').length, 31);
    assert.equal(daysInMonth('2026-09').length, 30);
  });

  it('starts on the first and ends on the last', () => {
    const days = daysInMonth('2026-08');
    assert.equal(days[0], '2026-08-01');
    assert.equal(days.at(-1), '2026-08-31');
  });

  it('is empty rather than wrong for nonsense', () => {
    assert.deepEqual(daysInMonth('not-a-month'), []);
    assert.deepEqual(daysInMonth('2026-13'), []);
  });
});

describe('shiftIsoMonth', () => {
  it('steps by months, never by thirty days', () => {
    assert.equal(shiftIsoMonth('2026-01', 1), '2026-02');
    assert.equal(shiftIsoMonth('2026-03', 1), '2026-04');
  });

  it('crosses the year in both directions', () => {
    assert.equal(shiftIsoMonth('2026-12', 1), '2027-01');
    assert.equal(shiftIsoMonth('2026-01', -1), '2025-12');
    assert.equal(shiftIsoMonth('2026-06', -18), '2024-12');
  });

  it('leaves nonsense alone', () => {
    assert.equal(shiftIsoMonth('rubbish', 1), 'rubbish');
  });
});

describe('gridColumns', () => {
  it('covers the day exactly once', () => {
    assert.equal(gridColumns(30).length, 48);
    assert.equal(gridColumns(60).length, 24);
    assert.equal(gridColumns(30).at(-1), 1410);
  });

  it('refuses a step that would never terminate', () => {
    assert.equal(gridColumns(0).length, 1440);
  });
});

describe('zonedInstant', () => {
  it('finds the instant a place’s clock read a time', () => {
    // London in August is UTC+1.
    const at = zonedInstant('2026-08-03', 12 * 60, LONDON_ZONE);
    assert.equal(at?.toISOString(), '2026-08-03T11:00:00.000Z');
  });

  it('handles a zone behind UTC and one well ahead', () => {
    assert.equal(
      zonedInstant('2026-08-03', 9 * 60, 'America/New_York')?.toISOString(),
      '2026-08-03T13:00:00.000Z',
    );
    assert.equal(
      zonedInstant('2026-08-03', 9 * 60, 'Asia/Tokyo')?.toISOString(),
      '2026-08-03T00:00:00.000Z',
    );
  });

  it('reports the hour the clocks skip as missing, not as the hour after it', () => {
    // 2026-03-29: London jumps 01:00 → 02:00. There is no 01:30 that morning.
    assert.equal(zonedInstant('2026-03-29', 90, LONDON_ZONE), null);
    assert.ok(zonedInstant('2026-03-29', 30, LONDON_ZONE), '00:30 still exists');
    assert.ok(zonedInstant('2026-03-29', 150, LONDON_ZONE), '02:30 still exists');
  });

  it('gives the first of the two occasions the clock reads a repeated hour', () => {
    // 2026-10-25: London falls back, so 01:30 happens twice — once at 00:30
    // UTC and once at 01:30 UTC. The grid has one column and takes the first.
    assert.equal(zonedInstant('2026-10-25', 90, LONDON_ZONE)?.toISOString(), '2026-10-25T00:30:00.000Z');
  });
});

describe('monthGrid', () => {
  const grid = monthGrid(EDINBURGH, '2026-08', LONDON_ZONE, { stepMinutes: 60 });

  it('is a rectangle of days by columns', () => {
    assert.equal(grid.days.length, 31);
    assert.equal(grid.columns.length, 24);
    for (const day of grid.days) assert.equal(day.cells.length, 24);
  });

  it('agrees with the sun engine cell by cell', () => {
    const cell = grid.days[2].cells[13];
    assert.ok(cell.at);
    const direct = sunPosition(EDINBURGH.lat, EDINBURGH.lon, cell.at!);
    assert.equal(cell.altitude, direct.altitude);
  });

  it('puts the sun higher at midday than at midnight, every day of the month', () => {
    for (const day of grid.days) {
      const noon = day.cells.find((c) => c.minute === 13 * 60)!;
      const midnight = day.cells.find((c) => c.minute === 0)!;
      assert.ok(noon.altitude! > midnight.altitude!, day.isoDate);
    }
  });

  it('leaves a hole where the clock skipped an hour, and shifts nothing', () => {
    const spring = monthGrid(EDINBURGH, '2026-03', LONDON_ZONE, { stepMinutes: 60 });
    const changeDay = spring.days.find((d) => d.isoDate === '2026-03-29')!;
    const missing = changeDay.cells.filter((c) => c.at === null);
    assert.equal(missing.length, 1, 'exactly one hour is missing');
    assert.equal(missing[0].minute, 60, 'and it is 01:00');
    // Every other day of the month is whole.
    for (const day of spring.days) {
      if (day.isoDate === '2026-03-29') continue;
      assert.ok(day.cells.every((c) => c.at !== null), day.isoDate);
    }
  });

  it('draws a twenty-five hour day without doubling a column', () => {
    const autumn = monthGrid(EDINBURGH, '2026-10', LONDON_ZONE, { stepMinutes: 60 });
    const changeDay = autumn.days.find((d) => d.isoDate === '2026-10-25')!;
    assert.equal(changeDay.cells.length, 24);
    assert.ok(changeDay.cells.every((c) => c.at !== null));
    const minutes = changeDay.cells.map((c) => c.minute);
    assert.equal(new Set(minutes).size, minutes.length);
  });

  it('reads forward in time along every row, including the day the clocks change', () => {
    for (const month of ['2026-03', '2026-08', '2026-10']) {
      for (const day of monthGrid(EDINBURGH, month, LONDON_ZONE, { stepMinutes: 30 }).days) {
        const instants = day.cells.map((c) => c.at).filter((at): at is Date => at !== null);
        for (let i = 1; i < instants.length; i++) {
          assert.ok(
            instants[i].getTime() > instants[i - 1].getTime(),
            `${day.isoDate} goes backwards at column ${i}`,
          );
        }
      }
    }
  });

  it('says the sun never rises where it never rises', () => {
    // Longyearbyen in December: polar night, every cell of every day.
    const polar = monthGrid({ lat: 78.22, lon: 15.63 }, '2026-12', 'Arctic/Longyearbyen', {
      stepMinutes: 120,
    });
    const everyCell = polar.days.flatMap((d) => d.cells);
    assert.ok(everyCell.every((c) => (c.altitude ?? 0) < 0));
    assert.ok(everyCell.every((c) => c.phase !== 'day' && c.phase !== 'golden'));
  });
});

describe('goldenRuns', () => {
  const cell = (minute: number, phase: 'golden' | 'day' | 'night') => ({
    minute,
    at: new Date(0),
    altitude: 0,
    phase,
  });

  it('finds the morning and evening bands separately', () => {
    const runs = goldenRuns({
      isoDate: '2026-08-03',
      cells: [
        cell(0, 'night'),
        cell(30, 'golden'),
        cell(60, 'golden'),
        cell(90, 'day'),
        cell(120, 'golden'),
        cell(150, 'night'),
      ],
    });
    assert.deepEqual(runs, [
      { from: 30, to: 90 },
      { from: 120, to: 150 },
    ]);
  });

  it('closes a run that is still open at the end of the day', () => {
    const runs = goldenRuns({
      isoDate: '2026-08-03',
      cells: [cell(0, 'day'), cell(1410, 'golden')],
    });
    assert.deepEqual(runs, [{ from: 1410, to: 1440 }]);
  });

  it('finds nothing on a day with no golden hour', () => {
    assert.deepEqual(goldenRuns({ isoDate: '2026-12-21', cells: [cell(0, 'night')] }), []);
  });
});

describe('formatColumn and monthOf', () => {
  it('reads as a clock', () => {
    assert.equal(formatColumn(0), '00:00');
    assert.equal(formatColumn(390), '06:30');
    assert.equal(formatColumn(1410), '23:30');
  });

  it('takes the month off a date', () => {
    assert.equal(monthOf('2026-08-03'), '2026-08');
  });
});
