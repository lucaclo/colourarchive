/**
 * The sky over the next week of sunsets (or sunrises), for the calendar.
 *
 * Alpenglow and Sunsethue sell several days of sunset forecast as one number
 * per evening. This gives each forecast day the same honest reading the panel
 * gives the day on screen, `horizonReading`'s lit / bare / blocked, and
 * nothing more: no score, and nothing at all past the forecast's end.
 *
 * Each evening's far sample is taken along *that* evening's sun bearing. The
 * sunset swings a degree or two a day around the equinoxes, which is 5–10 km
 * at 300 km out and grows to a different cloud cell within the week, so one
 * gate for every day would be reading the wrong sky by Sunday. Bearings are
 * rounded to BEARING_STEP so neighbouring days share a request.
 *
 * Pure: fetching is the caller's job.
 */

import { shiftIsoDate, zonedNoon } from './daylight';
import { sunPosition, sunTimes } from './sun';
import { horizonReading, hourAt, type HorizonVerdict, type WeatherReport } from './weather';

export type SkyEvent = 'sunrise' | 'sunset';

/** Degrees. Two is ~10 km of sideways drift at the 300 km sample. */
export const BEARING_STEP = 2;
/** Open-Meteo's live forecast is seven days; the calendar asks for no more. */
export const SKY_WEEK_DAYS = 7;

export interface SkyDay {
  iso: string;
  when: Date;
  /** The sun's azimuth at that moment, rounded to BEARING_STEP. */
  bearing: number;
}

/**
 * The event's time and bearing on each of `count` days from `fromIso`. Days
 * when the sun doesn't rise or set (polar day and night) are left out.
 */
export function skyDays(
  lat: number,
  lon: number,
  fromIso: string,
  timeZone: string,
  event: SkyEvent,
  count = SKY_WEEK_DAYS,
): SkyDay[] {
  const out: SkyDay[] = [];
  for (let i = 0; i < count; i++) {
    const iso = shiftIsoDate(fromIso, i);
    const times = sunTimes(lat, lon, zonedNoon(iso, timeZone));
    const when = event === 'sunrise' ? times.sunrise : times.sunset;
    if (!when) continue;
    const azimuth = sunPosition(lat, lon, when).azimuth;
    out.push({ iso, when, bearing: roundBearing(azimuth) });
  }
  return out;
}

export const roundBearing = (deg: number): number =>
  ((Math.round(deg / BEARING_STEP) * BEARING_STEP) % 360 + 360) % 360;

/** The distinct bearings to fetch a far sample along. */
export const bearingsFor = (days: readonly SkyDay[]): number[] => [...new Set(days.map((d) => d.bearing))];

export interface SkyMark {
  iso: string;
  verdict: Exclude<HorizonVerdict, 'unknown'>;
  note: string;
}

/**
 * One reading per day the forecast reaches. `gates` maps a bearing to the far
 * sample's forecast along it. A day with no hour in either forecast, or no
 * gate, gets no mark rather than a guess.
 */
export function skyMarks(
  days: readonly SkyDay[],
  pin: WeatherReport | null,
  gates: ReadonlyMap<number, WeatherReport | null>,
  distanceM: number,
): SkyMark[] {
  if (!pin) return [];
  const out: SkyMark[] = [];
  for (const d of days) {
    const gate = gates.get(d.bearing);
    if (!gate) continue;
    const reading = horizonReading(hourAt(gate, d.when), hourAt(pin, d.when), d.bearing, distanceM);
    if (reading.verdict === 'unknown') continue;
    out.push({ iso: d.iso, verdict: reading.verdict, note: reading.note });
  }
  return out;
}
