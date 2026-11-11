import { dayTrack, SUN_ALTITUDE } from './scout/sun';
import { describeLighting, type LightDirection } from './scout/lighting';
import type { SavedSpot } from './scout/spots';

/**
 * "Shoot this light": when the light in a reference next happens at a place
 * you've kept in Scout.
 *
 * A reference's light is read on the Mac (light-read.ts) as a phase — golden,
 * blue, overcast, midday, night — and, for direct sun, a direction relative
 * to the camera. This turns that into the next windows at each kept spot from
 * the sun's geometry and, where Scout's forecast reaches, the cloud.
 *
 * Geometry only, on purpose: no skyline or terrain shading here (Scout owns
 * that, per spot, on its own page), so a window says the sun is at the right
 * height and angle, and the link opens Scout at that minute to check what
 * actually stands in the way.
 */

export type LightPhase = 'golden' | 'blue' | 'overcast' | 'midday' | 'night';

export interface LightWish {
  phase: LightPhase;
  /** Direct sun only; null when the light has no direction to match. */
  direction: LightDirection | null;
}

export interface LightWindow {
  spot: SavedSpot;
  start: Date;
  end: Date;
  /** The spot has no saved aim, so the direction wasn't checked. */
  aimUnknown: boolean;
  /** Past the forecast's reach, so cloud wasn't checked. */
  noForecast: boolean;
}

/** Hourly cloud cover, percent, keyed by the hour's start in ms. */
export type CloudHours = Map<number, number>;

const STEP_MIN = 5;
const HOUR = 3_600_000;

/** Whether the sky allows this light at this hour, or null when nobody knows. */
export function skyAllows(phase: LightPhase, cloud: number | undefined): boolean | null {
  if (cloud == null) return null;
  switch (phase) {
    case 'overcast': return cloud >= 85;
    case 'night': return true;
    case 'blue': return cloud < 75;
    default: return cloud < 60; // direct sun needs a gap
  }
}

/** The sun-only test for one instant. `noonAltitude` is that day's highest. */
export function sunMatches(phase: LightPhase, altitude: number, noonAltitude: number): boolean {
  switch (phase) {
    case 'golden': return altitude > 0 && altitude <= SUN_ALTITUDE.goldenUpper;
    case 'blue': return altitude >= SUN_ALTITUDE.blueLower && altitude <= SUN_ALTITUDE.blueUpper;
    // In a northern winter the sun never reaches 35°: "midday" is near the day's highest.
    case 'midday': return altitude >= Math.min(35, noonAltitude - 6);
    case 'overcast': return altitude > SUN_ALTITUDE.goldenUpper;
    case 'night': return altitude < SUN_ALTITUDE.nautical;
  }
}

/**
 * The first window at one spot from `from`, within `days`. Contiguous
 * matching samples make one window; the first that also passes the cloud
 * (where the forecast reaches) is returned.
 */
export function nextWindow(
  spot: SavedSpot, wish: LightWish, from: Date, days: number, cloud?: CloudHours,
): LightWindow | null {
  const aim = spot.frame?.bearing;
  const checkAim = wish.direction != null && aim != null;
  const end = new Date(from.getTime() + days * 24 * HOUR);
  for (let day = new Date(from); day < end; day = new Date(day.getTime() + 24 * HOUR)) {
    const to = new Date(Math.min(day.getTime() + 24 * HOUR, end.getTime()));
    const samples = dayTrack(spot.lat, spot.lon, day, { stepMinutes: STEP_MIN, from: day, to });
    const noon = Math.max(...samples.map((s) => s.altitude));
    let run: { start: Date; last: Date; noForecast: boolean } | null = null;
    const finish = (r: NonNullable<typeof run>) => ({
      spot, start: r.start, end: new Date(r.last.getTime() + STEP_MIN * 60_000),
      aimUnknown: wish.direction != null && aim == null, noForecast: r.noForecast,
    });
    for (const s of samples) {
      let ok = sunMatches(wish.phase, s.altitude, noon);
      if (ok && checkAim) {
        const l = describeLighting({ aimBearing: aim, sunAzimuth: s.azimuth, sunAltitude: s.altitude, lit: s.altitude > 0 });
        // Low sun behind the subject is "rim" in Scout's terms: still backlight.
        ok = l.direction === wish.direction || (wish.direction === 'back' && l.direction === 'rim');
      }
      let unknown = false;
      if (ok && cloud) {
        const sky = skyAllows(wish.phase, cloud.get(Math.floor(s.date.getTime() / HOUR) * HOUR));
        if (sky === false) ok = false;
        unknown = sky === null;
      } else if (ok && !cloud && wish.phase !== 'night') {
        unknown = true;
      }
      if (ok) {
        if (run) { run.last = s.date; run.noForecast ||= unknown; } else run = { start: s.date, last: s.date, noForecast: unknown };
      } else if (run) {
        return finish(run);
      }
    }
    if (run) return finish(run);
  }
  return null;
}

/** The soonest windows across every kept spot, one per spot. */
export function planLight(
  spots: SavedSpot[], wish: LightWish, from: Date, days = 7, clouds: Map<SavedSpot, CloudHours> = new Map(), limit = 3,
): LightWindow[] {
  return spots
    .map((s) => nextWindow(s, wish, from, days, clouds.get(s)))
    .filter((w): w is LightWindow => Boolean(w))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit);
}

export const PHASE_WORDS: Record<LightPhase, string> = {
  golden: 'Golden hour',
  blue: 'Blue hour',
  overcast: 'Overcast',
  midday: 'High sun',
  night: 'Night',
};
export const DIRECTION_WORDS: Record<LightDirection, string> = {
  back: 'backlit',
  side: 'side light',
  front: 'front light',
  rim: 'rim light',
};

export const describeWish = (w: LightWish): string =>
  [PHASE_WORDS[w.phase], w.direction ? DIRECTION_WORDS[w.direction] : ''].filter(Boolean).join(' · ');
