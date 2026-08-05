/**
 * A month of light at one spot, as a grid.
 *
 * Scout answers "what is the light doing here, now" very well, and answers
 * "what about the 14th" only by scrubbing to the 14th. For a place you mean to
 * come back to, the question is which *days* are worth coming back on — and
 * that is a question about a shape rather than about a number. Rows are dates,
 * columns are time of day, and the golden hour becomes a pair of curves you can
 * see bending across the month rather than a time you look up thirty times.
 *
 * Everything here is pure: no DOM, no map, no fetch. The cloud that qualifies
 * all of this belongs to the forecast, which knows about the network; this file
 * hands back the instant of every cell so the caller can ask.
 *
 * **The local clock is the grid.** A column is a wall-clock time, not an offset
 * from anything, because "be there at six" is what a plan says. That makes the
 * two days a year the clock changes into real cases rather than edge cases: an
 * hour that never happened is a hole in the grid and is drawn as one, and an
 * hour that happened twice is drawn once, at its first occurrence. Building the
 * grid on UTC instants and labelling them afterwards would smear both across
 * every row in the month.
 */

import { isoDateIn, zoneOffsetMinutes } from './daylight';
import type { LatLon } from './geo';
import { phaseForAltitude, sunPosition, type SunPhase } from './sun';

const MINUTES_PER_DAY = 1440;

export interface GridCell {
  /** Minutes past local midnight — the column this cell sits in. */
  minute: number;
  /**
   * The instant the local clock read this, or null on a spring-forward day
   * where it never read it at all.
   */
  at: Date | null;
  /** Degrees above the horizon, or null where there is no such moment. */
  altitude: number | null;
  phase: SunPhase | null;
}

export interface GridDay {
  isoDate: string;
  cells: GridCell[];
}

export interface MonthGrid {
  /** `YYYY-MM`. */
  isoMonth: string;
  timeZone: string;
  /** Minutes past local midnight, one per column. */
  columns: number[];
  days: GridDay[];
}

/** `YYYY-MM` for the month a date falls in. */
export const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

/**
 * The same month shifted by whole months, staying a valid `YYYY-MM`.
 *
 * Done in months rather than in days: adding thirty days to January lands in
 * February and adding it to March lands in April, and a month-stepper that
 * sometimes skips a month is worse than no stepper.
 */
export function shiftIsoMonth(isoMonth: string, months: number): string {
  const [year, month] = isoMonth.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return isoMonth;
  const zeroBased = (year * 12 + (month - 1)) + months;
  const nextYear = Math.floor(zeroBased / 12);
  const nextMonth = zeroBased - nextYear * 12 + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}`;
}

/** Every calendar date in a month, in order. */
export function daysInMonth(isoMonth: string): string[] {
  const [year, month] = isoMonth.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return [];
  const days: string[] = [];
  // Day 0 of the next month is the last day of this one — which is how February
  // gets its leap day without a rule about leap days.
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= count; day++) {
    days.push(`${isoMonth}-${String(day).padStart(2, '0')}`);
  }
  return days;
}

/** The columns of a grid at a given resolution, in minutes past midnight. */
export function gridColumns(stepMinutes: number): number[] {
  const step = Math.max(1, Math.round(stepMinutes));
  const columns: number[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += step) columns.push(minute);
  return columns;
}

/**
 * The instant at which a place's clock read a given date and time.
 *
 * Null when it never did. On the morning the clocks go forward there is no
 * 01:30 in London: any arithmetic will happily produce *an* instant for it, and
 * that instant is 02:30, an hour the grid already has a column for. Returning
 * it would draw the same moment twice and quietly shift a whole row. So the
 * answer is checked by converting back, and a time the clock skipped is
 * reported as missing rather than as approximately correct.
 */
export function zonedInstant(isoDate: string, minute: number, timeZone: string): Date | null {
  const midnight = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(midnight)) return null;
  const wanted = midnight + minute * 60_000;

  // Every offset the zone might be using anywhere near this moment. Iterating
  // to a fixed point instead — the usual trick, and what `zonedNoon` does —
  // converges on *an* answer without ever noticing there were two, and the one
  // it settles on for a repeated hour is the later one. That would make a row
  // of the grid run backwards between 01:30 and 02:00.
  const probes = [wanted - 2 * 3_600_000, wanted, wanted + 2 * 3_600_000];
  const offsets = [...new Set(probes.map((p) => zoneOffsetMinutes(new Date(p), timeZone)))];

  const reads = (candidate: Date) => {
    if (isoDateIn(candidate, timeZone) !== isoDate) return false;
    const local = candidate.getTime() + zoneOffsetMinutes(candidate, timeZone) * 60_000;
    return Math.floor(local / 60_000) % MINUTES_PER_DAY === minute % MINUTES_PER_DAY;
  };

  // The earliest instant whose clock actually read this. On an ordinary day
  // there is exactly one; on the morning the clocks go forward there are none,
  // which is the honest answer; on the morning they go back there are two and
  // the first is the one that keeps the day in order.
  const candidates = offsets
    .map((offset) => new Date(wanted - offset * 60_000))
    .filter(reads)
    .sort((a, b) => a.getTime() - b.getTime());
  return candidates[0] ?? null;
}

export interface MonthGridOptions {
  /** Column width in minutes. 30 gives 48 columns, which fits a phone. */
  stepMinutes?: number;
}

/**
 * The whole month.
 *
 * One `sunPosition` per cell — about 1,500 at half-hourly resolution, which is
 * arithmetic on a few dozen coefficients and costs less than a single map tile.
 * No attempt is made to interpolate between columns: the sun's altitude is
 * cheap and an interpolated golden hour would be a drawing rather than an
 * answer.
 */
export function monthGrid(
  centre: LatLon,
  isoMonth: string,
  timeZone: string,
  { stepMinutes = 30 }: MonthGridOptions = {},
): MonthGrid {
  const columns = gridColumns(stepMinutes);
  const days = daysInMonth(isoMonth).map((isoDate) => ({
    isoDate,
    cells: columns.map((minute): GridCell => {
      const at = zonedInstant(isoDate, minute, timeZone);
      if (!at) return { minute, at: null, altitude: null, phase: null };
      const { altitude } = sunPosition(centre.lat, centre.lon, at);
      return { minute, at, altitude, phase: phaseForAltitude(altitude) };
    }),
  }));
  return { isoMonth, timeZone, columns, days };
}

/**
 * The best hours of a day, as the grid sees them.
 *
 * "Best" here means only the golden band, and it is deliberately literal: the
 * run of columns whose phase is `golden`. Anything cleverer — weighting by
 * cloud, by how long the run is, by which side of noon it falls on — would be
 * an opinion, and the grid's whole argument is that you can see the shape and
 * form your own.
 */
export function goldenRuns(day: GridDay): Array<{ from: number; to: number }> {
  const runs: Array<{ from: number; to: number }> = [];
  let start: number | null = null;
  for (const cell of day.cells) {
    if (cell.phase === 'golden') {
      if (start === null) start = cell.minute;
      continue;
    }
    if (start !== null) {
      runs.push({ from: start, to: cell.minute });
      start = null;
    }
  }
  if (start !== null) runs.push({ from: start, to: MINUTES_PER_DAY });
  return runs;
}

/** "06:30" from minutes past midnight, for a column heading. */
export function formatColumn(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  return `${String(hour).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
