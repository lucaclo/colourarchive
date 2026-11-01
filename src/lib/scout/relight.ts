/**
 * The next time the light stands where it stood (issue #160).
 *
 * A photograph's own moment says where the sun was: its azimuth and how high.
 * The sun comes back to that same place twice a year, on the anniversary and
 * on the date mirrored about the solstice (the sun at 20° in the east on
 * 1 May is at 20° in the east again around 11 August), at very nearly the same
 * altitude on the same side of noon. So "plan this shot again" can name the
 * next morning or evening the light repeats, rather than only "same day next
 * year".
 *
 * For each day ahead, find the instant the sun crosses the photo's altitude on
 * the same side of noon (rising or setting), and compare azimuths; the first
 * day whose miss reaches a minimum inside the tolerance is the answer.
 * Taken after dusk, there is no sun to match and it says so.
 */

import { sunPosition } from './sun';

export type RelightKind = 'anniversary' | 'mirror';

export type Relight =
  | { kind: RelightKind; at: Date; azimuth: number; altitude: number; missDeg: number }
  | { kind: 'dark'; refusal: string };

/** Sun lower than this at the moment of the photo: nothing to match. */
export const DARK_ALTITUDE = -6;
/** A day counts when its azimuth misses by less than this. */
export const MISS_TOLERANCE_DEG = 1;

const DAY = 86_400_000;
const MIN = 60_000;

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

export function sameLightAhead(lat: number, lon: number, taken: Date, from: Date, days = 400): Relight {
  const then = sunPosition(lat, lon, taken);
  if (then.altitude < DARK_ALTITUDE) {
    return { kind: 'dark', refusal: 'Taken after dark, so there’s no sun to match; the same date a year on is shown.' };
  }
  const rising = sunPosition(lat, lon, new Date(taken.getTime() + 5 * MIN)).altitude > then.altitude;
  const target = then.altitude;

  // The first same-clock-time instant at or after `from`.
  let k = Math.ceil((from.getTime() - taken.getTime()) / DAY);
  if (k < 1) k = 1;

  let prevMiss = Infinity;
  let best: { at: Date; azimuth: number; altitude: number; miss: number } | null = null;
  for (let i = 0; i < days; i++, k++) {
    const centre = taken.getTime() + k * DAY;
    const hit = crossing(lat, lon, centre, target, rising);
    if (!hit) {
      prevMiss = Infinity;
      continue;
    }
    const miss = Math.abs(wrap(hit.azimuth - then.azimuth));
    if (best && miss > best.miss && best.miss <= MISS_TOLERANCE_DEG) break; // past the minimum
    if (miss < prevMiss && miss <= MISS_TOLERANCE_DEG) best = { ...hit, miss };
    else if (best && miss > prevMiss) break;
    prevMiss = miss;
  }
  if (!best) return { kind: 'dark', refusal: 'The sun doesn’t stand there again within a year here.' };
  const daysFromAnniversary = Math.abs(((best.at.getTime() - taken.getTime()) / DAY) % 365.2422);
  const kind: RelightKind = Math.min(daysFromAnniversary, 365.2422 - daysFromAnniversary) < 15 ? 'anniversary' : 'mirror';
  return { kind, at: best.at, azimuth: best.azimuth, altitude: best.altitude, missDeg: best.miss };
}

/** The instant within three hours of `centre` the sun crosses `target` altitude going the right way. */
function crossing(lat: number, lon: number, centre: number, target: number, rising: boolean) {
  const step = 4 * MIN;
  let t0 = centre - 3 * 60 * MIN;
  let a0 = sunPosition(lat, lon, new Date(t0)).altitude - target;
  for (let t1 = t0 + step; t1 <= centre + 3 * 60 * MIN; t1 += step) {
    const a1 = sunPosition(lat, lon, new Date(t1)).altitude - target;
    const up = a0 < 0 && a1 >= 0;
    const down = a0 > 0 && a1 <= 0;
    if ((rising && up) || (!rising && down)) {
      let lo = t0;
      let hi = t1;
      for (let j = 0; j < 20; j++) {
        const mid = (lo + hi) / 2;
        const am = sunPosition(lat, lon, new Date(mid)).altitude - target;
        if ((am < 0) === rising) lo = mid;
        else hi = mid;
      }
      const at = new Date((lo + hi) / 2);
      const p = sunPosition(lat, lon, at);
      return { at, azimuth: p.azimuth, altitude: p.altitude };
    }
    t0 = t1;
    a0 = a1;
  }
  return null;
}
