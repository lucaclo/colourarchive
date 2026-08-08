import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { forecastDaysCovered } from './month-grid.ts';

describe('how far into the month the forecast reaches', () => {
  // A 31-day month at half-hourly resolution.
  const days = 31;
  const columns = 48;

  it('counts whole days when the forecast fills them', () => {
    assert.equal(forecastDaysCovered(7 * columns, days, columns), 7);
    assert.equal(forecastDaysCovered(0, days, columns), 0);
  });

  it('never claims more of the month than there is', () => {
    assert.equal(forecastDaysCovered(days * columns, days, columns), days);
  });

  it('rounds a part-day rather than truncating it', () => {
    // Open-Meteo's window ends at an hour, not at a midnight, so the last day
    // is usually partial — the legend says "about" for exactly this reason.
    assert.equal(forecastDaysCovered(6 * columns + columns / 2, days, columns), 7);
    assert.equal(forecastDaysCovered(6 * columns + 1, days, columns), 6);
  });

  it('answers nought rather than dividing by zero on an empty grid', () => {
    // `monthGrid` cannot currently return one, but a legend that reads "NaN
    // days" is a worse failure than a wrong number, and it costs one guard.
    assert.equal(forecastDaysCovered(0, 0, columns), 0);
    assert.equal(forecastDaysCovered(0, days, 0), 0);
    assert.ok(Number.isFinite(forecastDaysCovered(10, 0, 0)));
  });
});
