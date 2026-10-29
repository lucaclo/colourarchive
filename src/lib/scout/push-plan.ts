/**
 * When to tell you a kept spot reads lit, and what to say (issue #142).
 *
 * Scout reads each evening's horizon as lit / bare / blocked (sky-week.ts),
 * but only for whoever opens it. This decides when a notification about a
 * kept spot is worth sending and words it: the spot, the time, and the sky in
 * words. Never a score.
 *
 * - Sunset: from two hours before that evening's golden hour until it starts,
 *   so there's time to get there.
 * - Sunrise: the evening before, 19:00–23:00 where the spot is, since a
 *   message two hours before a 5 am golden hour wakes nobody in time.
 *
 * Pure: the server's loop (lib/push.ts) supplies the clock and the readings.
 */

import { isoDateIn, shiftIsoDate, zonedNoon } from './daylight';
import { sunTimes } from './sun';
import type { SkyEvent } from './sky-week';

export interface PushSpot {
  /** Stable across devices: rounded coordinates. */
  key: string;
  name: string;
  lat: number;
  lon: number;
  timeZone: string;
  muted?: boolean;
}

export interface PushPlan {
  event: SkyEvent;
  /** The local date of the sunrise or sunset. */
  iso: string;
  when: Date;
}

const LEAD_MS = 2 * 3600_000;

export const spotKey = (lat: number, lon: number): string => `${lat.toFixed(3)},${lon.toFixed(3)}`;

function localHour(now: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(now));
}

/** What could be announced for `spot` at `now` (0–2 plans). */
export function pushPlans(spot: PushSpot, now: Date): PushPlan[] {
  if (spot.muted) return [];
  const tz = spot.timeZone || 'UTC';
  const today = isoDateIn(now, tz);
  const out: PushPlan[] = [];

  const t = sunTimes(spot.lat, spot.lon, zonedNoon(today, tz));
  const evening = t.goldenHour.filter((w) => w.start > t.solarNoon).sort((a, b) => +a.start - +b.start)[0];
  if (t.sunset && evening && +now >= +evening.start - LEAD_MS && +now < +evening.start) {
    out.push({ event: 'sunset', iso: today, when: t.sunset });
  }

  const hour = localHour(now, tz);
  if (hour >= 19 && hour < 23) {
    const tomorrow = shiftIsoDate(today, 1);
    const sunrise = sunTimes(spot.lat, spot.lon, zonedNoon(tomorrow, tz)).sunrise;
    if (sunrise) out.push({ event: 'sunrise', iso: tomorrow, when: sunrise });
  }
  return out;
}

const DIRECTIONS: Record<string, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west' };
const EIGHTHS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The sky in words, from the lit reading's two covers. */
export function skyWords(canvasCover: number, bearing: number): string {
  const deck = canvasCover < 35 ? 'Some high cloud' : canvasCover < 70 ? 'High cloud' : 'A full sky of high cloud';
  const dir = DIRECTIONS[EIGHTHS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]];
  return `${deck}, open to the ${dir}`;
}

/** "Sunset 16:38 · High cloud, open to the west". Tomorrow's sunrise says so. */
export function pushMessage(spot: PushSpot, plan: PushPlan, reading: { canvasCover: number; bearing: number }, now: Date): { title: string; body: string } {
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: spot.timeZone || 'UTC' }).format(plan.when);
  const when = plan.event === 'sunset' ? `Sunset ${time}` : plan.iso === isoDateIn(now, spot.timeZone || 'UTC') ? `Sunrise ${time}` : `Sunrise tomorrow ${time}`;
  return { title: spot.name, body: `${when} · ${skyWords(reading.canvasCover, reading.bearing)}` };
}
