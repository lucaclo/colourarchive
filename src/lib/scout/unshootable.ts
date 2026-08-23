/**
 * The unshootable list — chapters ranked by nearest confirmed opportunity.
 *
 * Joins #59 (`gap-shoots.ts`: which colours the archive is missing, and when
 * the sun engine says a place could produce them) with the same weather
 * honesty #64 (`go-tonight.ts`) already applies: a date is not a plan until
 * the forecast, where it reaches that far, actually agrees. This is that
 * join for the gap list specifically — re-ranked so a gap with a
 * weather-confirmed date this week outranks one with a geometrically
 * "sooner" date the forecast cannot yet speak to, which in turn outranks a
 * gap this place never reaches at all.
 *
 * There is no bearing here the way `go-tonight.ts` has one — a gap shoot is
 * about the sun's *altitude*, not about a compass point behind something —
 * so "confirmed" is simpler and purely local: low enough cloud, at the
 * matched hour, that the clear-sky atmosphere physics `light-locus.ts` used
 * to find the recipe is still approximately true. `CLEAR_ENOUGH_COVER_PCT`
 * is the same boundary `weather.ts`'s own `lightQuality` draws between
 * "mostly sun" and "broken cloud" — reused rather than re-invented.
 *
 * Pure. Fetching the forecast is the caller's job.
 */

import type { GapOccurrence, GapShoot } from './gap-shoots';
import { directLightFractionFor, hourAt, type WeatherReport } from './weather';

/** Below this cloud cover, the light is close enough to the clear-sky model
 *  a gap's recipe assumed. Matches the "mostly sun" boundary in `weather.ts`. */
export const CLEAR_ENOUGH_COVER_PCT = 35;

export interface RankedGapShoot {
  shoot: GapShoot;
  /** The soonest occurrence with a confirmed-clear local forecast — null when
   *  none of the occurrences fall inside the forecast's reach, or none there
   *  are clear enough. */
  confirmed: GapOccurrence | null;
}

function isClear(occurrence: GapOccurrence, weather: WeatherReport | null): boolean {
  if (!weather) return false;
  const hour = hourAt(weather, occurrence.at);
  if (!hour) return false;
  const cover = hour.cloudCover;
  if (cover != null && Number.isFinite(cover)) return cover < CLEAR_ENOUGH_COVER_PCT;
  // No cloud figure at all reads through `directLightFractionFor`'s own
  // fallback (full light) — treated as clear rather than unknown, the same
  // optimistic default that function already applies.
  return directLightFractionFor(hour) > 1 - CLEAR_ENOUGH_COVER_PCT / 100;
}

/**
 * A gap's occurrences, weather-checked where the forecast reaches.
 */
function confirmFor(shoot: GapShoot, weather: WeatherReport | null): GapOccurrence | null {
  for (const occurrence of shoot.occurrences) {
    if (isClear(occurrence, weather)) return occurrence;
  }
  return null;
}

/**
 * Every gap shoot, weather-checked and ranked: confirmed-and-soonest first,
 * then reachable-but-unconfirmed by nearest date, then a real recipe this
 * place just never reaches in the window, then the colours pure daylight
 * cannot make at all. Each tier is a different claim and the order between
 * tiers is never broken by how the dates inside them happen to fall.
 */
export function rankUnshootable(shoots: GapShoot[], weather: WeatherReport | null): RankedGapShoot[] {
  const ranked: RankedGapShoot[] = shoots.map((shoot) => ({
    shoot,
    confirmed: confirmFor(shoot, weather),
  }));

  const tier = (r: RankedGapShoot): number => {
    if (r.confirmed) return 0;
    if (r.shoot.occurrences.length) return 1;
    if (r.shoot.match) return 2;
    return 3;
  };

  const soonest = (r: RankedGapShoot): number => {
    if (r.confirmed) return r.confirmed.at.getTime();
    if (r.shoot.occurrences.length) return r.shoot.occurrences[0].at.getTime();
    return Infinity;
  };

  return [...ranked].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    return soonest(a) - soonest(b);
  });
}
