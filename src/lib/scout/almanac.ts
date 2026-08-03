/**
 * The four corners of the year: the equinoxes and the solstices.
 *
 * These are the dates worth scouting *against* rather than on. The June
 * solstice is the northernmost the sun will ever rise for you and the highest it
 * will ever get; the December one is the other extreme. Draw those two arcs
 * beside today's and the whole envelope of what a spot can ever do is on screen
 * at once — a wall that is in shade at noon today may be lit at noon in June,
 * and there is no way to see that from one day's path.
 *
 * Solved rather than tabulated. An equinox is by definition the instant the
 * sun's apparent ecliptic longitude reaches an exact multiple of 90°, so
 * finding one is a root find over a function this project already has and
 * already tests, and it needs no table of coefficients that could be mistyped.
 *
 * **Accuracy, measured rather than assumed.** Against the published 2026
 * events these come out −7.9, −4.4, +4.1 and −1.2 minutes. That is the periodic
 * error of the low-accuracy solar series in `sun.ts`, which omits the planetary
 * perturbations and is honest about being good to about 0.01° — and 0.01° of
 * solar longitude *is* fifteen minutes of time. Reaching seconds would mean
 * carrying VSOP87.
 *
 * Which is why nothing here is presented to the minute. A solstice is used for
 * two things: printing a date, and choosing which day's arc to draw as a
 * reference. Eight minutes never moves the date, and at a solstice the sun's
 * declination is stationary by definition — eight minutes changes it by less
 * than a millionth of a degree. The precision that exists is the precision the
 * feature needs; quoting a solstice to the second would be inventing four
 * digits this model does not have.
 *
 * Pure. No map, no DOM, no clock of its own.
 */

import { solarState } from './sun';

const DAY_MS = 86_400_000;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;

/** Apparent solar longitude at an instant, degrees, 0–360. */
export function apparentSolarLongitude(date: Date): number {
  const jd = date.getTime() / DAY_MS + UNIX_EPOCH_JD;
  const T = (jd - J2000) / 36525;
  const longitude = solarState(T).apparentLongitude;
  return ((longitude % 360) + 360) % 360;
}

/** Signed shortest way round from `b` to `a`, in ±180°. */
const signedGap = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/**
 * When the sun's apparent longitude next equals `target`, searching out from
 * `seed`.
 *
 * Newton's method with the derivative hard-coded as the sun's mean daily motion
 * — 0.9856°, which is within 2% of the true rate all year because the earth's
 * orbit is very nearly circular. That is more than good enough for a Newton
 * step: each pass cuts the error by two orders of magnitude, and five passes
 * from a seed a week out land inside a second.
 */
export function solarLongitudeCrossing(target: number, seed: Date): Date {
  const MEAN_MOTION_PER_DAY = 0.98564736;
  let t = seed.getTime();
  for (let pass = 0; pass < 8; pass++) {
    const error = signedGap(target, apparentSolarLongitude(new Date(t)));
    const stepMs = (error / MEAN_MOTION_PER_DAY) * DAY_MS;
    t += stepMs;
    if (Math.abs(stepMs) < 100) break;
  }
  return new Date(Math.round(t));
}

export type SeasonKey =
  | 'march-equinox'
  | 'june-solstice'
  | 'september-equinox'
  | 'december-solstice';

export interface SeasonEvent {
  key: SeasonKey;
  /** Hemisphere-neutral name — the one that is true wherever you are standing. */
  label: string;
  /** The sun's apparent longitude at the event, degrees. */
  longitude: number;
  date: Date;
}

/** Approximate dates to seed the search from; the solver does the rest. */
const SEEDS: Array<{ key: SeasonKey; label: string; longitude: number; month: number; day: number }> = [
  { key: 'march-equinox', label: 'March equinox', longitude: 0, month: 2, day: 20 },
  { key: 'june-solstice', label: 'June solstice', longitude: 90, month: 5, day: 21 },
  { key: 'september-equinox', label: 'September equinox', longitude: 180, month: 8, day: 22 },
  { key: 'december-solstice', label: 'December solstice', longitude: 270, month: 11, day: 21 },
];

/**
 * The four events of a given year, as UTC instants.
 *
 * Named by month rather than by season, deliberately. "Summer solstice" is a
 * different date in Sydney than in Stockholm, and a tool that quietly assumes
 * the northern hemisphere is the sort of thing that goes unnoticed for years.
 * `seasonName` does the hemisphere translation, once, where the latitude is
 * actually known.
 */
export function seasonEvents(year: number): SeasonEvent[] {
  return SEEDS.map(({ key, label, longitude, month, day }) => ({
    key,
    label,
    longitude,
    date: solarLongitudeCrossing(longitude, new Date(Date.UTC(year, month, day, 12))),
  }));
}

/** What a given event is called where you are standing. */
export function seasonName(key: SeasonKey, latitude: number): string {
  const north = latitude >= 0;
  switch (key) {
    case 'march-equinox':
      return north ? 'Spring equinox' : 'Autumn equinox';
    case 'june-solstice':
      return north ? 'Summer solstice' : 'Winter solstice';
    case 'september-equinox':
      return north ? 'Autumn equinox' : 'Spring equinox';
    case 'december-solstice':
      return north ? 'Winter solstice' : 'Summer solstice';
  }
}

/**
 * The two solstices bracketing an instant — the highest and lowest paths the sun
 * will trace at that place, which is what the reference arcs on the map draw.
 *
 * Picked as the June and December solstices nearest the date rather than the
 * ones inside its calendar year, so a scout on 28 December is shown the solstice
 * three days behind rather than one three hundred and sixty days ahead.
 */
export function bracketingSolstices(date: Date): { june: Date; december: Date } {
  const year = date.getUTCFullYear();
  const nearest = (longitude: number, month: number, day: number) => {
    const candidates = [year - 1, year, year + 1].map((y) =>
      solarLongitudeCrossing(longitude, new Date(Date.UTC(y, month, day, 12))),
    );
    return candidates.reduce((best, candidate) =>
      Math.abs(candidate.getTime() - date.getTime()) < Math.abs(best.getTime() - date.getTime())
        ? candidate
        : best,
    );
  };
  return { june: nearest(90, 5, 21), december: nearest(270, 11, 21) };
}

/**
 * The next of the four to happen after `after`, with how far off it is.
 *
 * Searches the neighbouring years too: asked on 30 December, the next event is
 * in March of the year after.
 */
export function nextSeasonEvent(after: Date): SeasonEvent & { inDays: number } {
  const year = after.getUTCFullYear();
  const all = [...seasonEvents(year), ...seasonEvents(year + 1)];
  const next = all.find((event) => event.date.getTime() > after.getTime()) ?? all[all.length - 1];
  return { ...next, inDays: (next.date.getTime() - after.getTime()) / DAY_MS };
}
