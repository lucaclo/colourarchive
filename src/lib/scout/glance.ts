/**
 * The top of the Scout panel: the answer first, the arithmetic behind a tap.
 *
 * Apple Weather opens on one summary and keeps the detail in modules you
 * tap; Flighty shows only what matters for the phase you are in. These are
 * the small pure pieces that let the panel do the same: a short word for the
 * light, the next thing the sun does, the half of the day's times that is
 * still worth reading, and a spot title a person would recognise.
 */
import type { SunEventRow } from './daylight';

/**
 * The light in two or three words, for the headline.
 *
 * The same thresholds as `lightQuality` in weather.ts, which stays the
 * sentence behind the Sky tile. Null cover means no forecast, and then the
 * headline says nothing about cloud rather than guessing.
 */
export function lightWord(cloudCover: number | null | undefined, sunAltitude: number): string | null {
  if (sunAltitude <= -0.833) return null;
  if (cloudCover == null || !Number.isFinite(cloudCover)) return null;
  const cover = Math.min(100, Math.max(0, cloudCover));
  if (cover < 12) return 'Hard light';
  if (cover < 35) return 'Light comes and goes';
  if (cover < 65) return 'Soft light';
  if (cover < 88) return 'Weak shadows';
  return 'Flat light';
}

export type NextLight =
  | { kind: 'now'; label: string; until: Date }
  | { kind: 'next'; label: string; at: Date }
  | { kind: 'over' };

/**
 * What the sun does next, or the window it is in now.
 *
 * Inside a golden or blue hour, that window is the answer ("Golden hour
 * until 18:14"). Otherwise it is the next row that has a time. Solar noon is
 * skipped as a "next" event because nobody plans a shoot for it, but it
 * still shows in the times list. After last light, the day is over.
 */
export function nextLight(rows: SunEventRow[], now: Date): NextLight {
  const t = now.getTime();
  for (const row of rows) {
    if (row.start && row.end && row.start.getTime() <= t && t < row.end.getTime()) {
      return { kind: 'now', label: row.label, until: row.end };
    }
  }
  for (const row of rows) {
    if (row.key === 'solarNoon' || !row.start) continue;
    if (row.start.getTime() > t) return { kind: 'next', label: row.label, at: row.start };
  }
  return { kind: 'over' };
}

/**
 * The half of the day that is still ahead: the morning rows up to noon
 * before solar noon, and noon onwards after it. "All times" shows the rest.
 */
export function phaseRows(rows: SunEventRow[], now: Date): SunEventRow[] {
  const noon = rows.find((row) => row.key === 'solarNoon');
  if (!noon?.start) return rows;
  const index = rows.indexOf(noon);
  return now.getTime() < noon.start.getTime() ? rows.slice(0, index + 1) : rows.slice(index);
}

/**
 * Has the last of the day's light gone? True once `now` is past the end of
 * the final row with a time (last light, or the evening blue hour), so the
 * list can roll on to tomorrow morning the way Flighty moves to the next leg
 * once a flight has landed.
 */
export function isAfterDark(rows: SunEventRow[], now: Date): boolean {
  const ends = rows
    .map((row) => (row.end ?? row.start)?.getTime())
    .filter((t): t is number => Number.isFinite(t));
  if (!ends.length) return false;
  return now.getTime() > Math.max(...ends);
}

/** The morning half of a day's rows, up to and including solar noon. */
export function morningRows(rows: SunEventRow[]): SunEventRow[] {
  const index = rows.findIndex((row) => row.key === 'solarNoon');
  return index < 0 ? rows : rows.slice(0, index + 1);
}

/**
 * A photo title fit to head a list row, or null when it is a file name.
 *
 * Commons and Flickr titles are often camera or upload names such as
 * "IMG_4021", "DSC00012" or "13-08-hongkong-Ralf-10". Those read as noise, so
 * the caller falls back to a plain "Photo spot". A real title with spaces in
 * it, even one ending in a number ("Central Pier 9"), is kept.
 */
export function readableTitle(title: string | null | undefined): string | null {
  const trimmed = (title ?? '').replace(/\.[a-z0-9]{3,4}$/i, '').trim();
  if (!trimmed) return null;
  if (/^(img|dsc|dscf|dscn|pxl|mvimg|gopr|p\d{3}|_mg|dji)[\s_-]?\d+/i.test(trimmed)) return null;
  if (!/\s/.test(trimmed) && /\d/.test(trimmed) && /[-_]/.test(trimmed)) return null;
  return trimmed;
}
