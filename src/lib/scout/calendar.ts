/**
 * The month grid behind the date chip's calendar.
 *
 * Plain ISO strings throughout (`YYYY-MM-DD`, `YYYY-MM`), the same currency
 * as the rest of Scout's dates, so no time zone can creep in: a calendar day
 * here is a label, and the place's own zone is applied by whoever turns it
 * into an instant (`zonedNoon`).
 */

/** Weeks of seven, Monday first, with null for the days of the neighbouring months. */
export function monthGrid(isoMonth: string): Array<Array<string | null>> {
  const [year, month] = isoMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // getUTCDay is 0 for Sunday; Monday-first puts Sunday last.
  const lead = (first.getUTCDay() + 6) % 7;
  const cells: Array<string | null> = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= days; day++) {
    cells.push(`${isoMonth}-${String(day).padStart(2, '0')}`);
  }
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The month before or after, as `YYYY-MM`. */
export function shiftMonth(isoMonth: string, by: number): string {
  const [year, month] = isoMonth.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + by, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "October 2026". */
export function monthTitle(isoMonth: string): string {
  const [year, month] = isoMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
