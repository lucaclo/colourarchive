/**
 * Which kept spot is actually worth going to tonight.
 *
 * Two things Scout already computes never look at each other: `alignment.ts`
 * knows every future date a spot's own kept bearing meets the sun or moon,
 * and `weather.ts` knows — deliberately without a score — whether the sky
 * will let the light out and give it something to land on. A spot with a
 * beautiful alignment next Thursday and a spot with a clear forecast tonight
 * are two different, useful facts; this is only the point where they get
 * compared, on the dates the forecast can actually reach.
 *
 * That reach is short — Open-Meteo's live forecast is seven days, and this
 * refuses to guess past it. An alignment eleven days out is a real answer
 * from `alignment.ts` and simply has no weather opinion attached yet; it is
 * not treated as bad news, just as unweathered.
 *
 * **"Confirmed" means the horizon verdict is `lit` or `bare`** — the same
 * two readings `weather.ts` itself calls a clear sky, never a fraction of
 * direct light on its own. A forecast that has arrived but reads `blocked`
 * is exactly as unconfirmed as one that has not arrived yet; both mean
 * "don't drive there for this", and collapsing "no data" and "bad weather"
 * into one true/false would have hidden that distinction.
 *
 * `horizonDeg: 0` is used for every spot searched here on purpose: this runs
 * over every kept spot at once, most of which have no terrain loaded (that
 * only happens for whichever place is on screen), so a flat horizon is the
 * only honest default and the note says so plainly rather than pretending to
 * a precision the search does not have.
 *
 * Pure. Fetching the forecasts is the caller's job, same split as
 * `alignment-panel.ts` keeps between the astronomy and the DOM.
 */

import { MOON, SUN, findAlignments, type Alignment } from './alignment';
import { destination, type LatLon } from './geo';
import type { SavedSpot } from './spots';
import {
  directLightFractionFor,
  horizonReading,
  horizonSampleDistanceM,
  hourAt,
  type HorizonReading,
  type WeatherReport,
} from './weather';

export type GoTonightBody = 'sun' | 'moon';

/** How far ahead to search for an alignment at all — a year, same as the panel. */
export const SEARCH_DAYS = 365;

export interface GoTonightOpportunity {
  spot: SavedSpot;
  body: GoTonightBody;
  /** The nearest meeting pass within the search window. */
  alignment: Alignment;
  /**
   * Fraction of direct light reaching the spot itself at that hour, 0–1 —
   * null when the alignment falls outside the forecast's own reach.
   */
  directLightFraction: number | null;
  /** The distant read — cloud on the horizon vs. cloud overhead. Null when
   *  either sample is missing or the alignment is unforecast. */
  horizon: HorizonReading | null;
  /** True only when the pass meets AND the horizon reads clear (`lit` or
   *  `bare`) — see the module comment on why "has a forecast" is not this. */
  confirmed: boolean;
  /** One line for the panel: the recipe, or the honest reason there isn't one. */
  note: string;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** The horizon verdicts that mean the light actually gets out. `blocked` and
 *  `unknown` are both a no, for different reasons, neither a maybe. */
const CLEAR_VERDICTS: HorizonReading['verdict'][] = ['lit', 'bare'];

function noteFor(opportunity: Omit<GoTonightOpportunity, 'note' | 'confirmed'>): string {
  const verb = opportunity.alignment.descending ? 'sets' : 'rises';
  const bodyWord = opportunity.body === 'sun' ? 'Sun' : 'Moon';
  const when = opportunity.alignment.best.at.toISOString().slice(0, 16).replace('T', ' ');
  const off = `${round1(Math.abs(opportunity.alignment.best.clearanceDeg))}° off`;

  if (opportunity.directLightFraction == null) {
    return `${bodyWord} ${verb} on the kept bearing ${when} UTC (${off}), too far out for a forecast yet.`;
  }
  const pct = Math.round(opportunity.directLightFraction * 100);
  if (opportunity.horizon) {
    return `${bodyWord} ${verb} on the kept bearing ${when} UTC (${off}) — ${pct}% direct light locally, horizon reads ${opportunity.horizon.verdict}: ${opportunity.horizon.note}`;
  }
  return `${bodyWord} ${verb} on the kept bearing ${when} UTC (${off}) — ${pct}% direct light forecast locally.`;
}

/**
 * One spot's nearest upcoming alignment, weather-checked where the forecast
 * reaches. `null` when the spot has no kept bearing (nothing to search on —
 * refuse rather than invent one, the same rule `alignment-panel.ts` applies
 * to an unplaced sightline target) or no meeting pass at all in the window.
 */
export function evaluateGoTonight(
  spot: SavedSpot,
  body: GoTonightBody,
  from: Date,
  pinWeather: WeatherReport | null,
  gateWeather: WeatherReport | null,
): GoTonightOpportunity | null {
  if (!spot.frame) return null;
  const point: LatLon = { lat: spot.lat, lon: spot.lon };
  const search = findAlignments(body === 'sun' ? SUN : MOON, point, {
    bearing: spot.frame.bearing,
    horizonDeg: 0,
    from,
    days: SEARCH_DAYS,
  });
  const met = search.events.filter((event) => event.meets).sort((a, b) => a.best.at.getTime() - b.best.at.getTime());
  const alignment = met[0];
  if (!alignment) return null;

  const pinHour = pinWeather ? hourAt(pinWeather, alignment.best.at) : null;
  const directLightFraction = pinHour ? directLightFractionFor(pinHour) : null;

  let horizon: HorizonReading | null = null;
  if (pinHour && gateWeather) {
    const gateHour = hourAt(gateWeather, alignment.best.at);
    if (gateHour) horizon = horizonReading(gateHour, pinHour, spot.frame.bearing, horizonSampleDistanceM());
  }

  const confirmed = alignment.meets && horizon != null && CLEAR_VERDICTS.includes(horizon.verdict);
  const partial = { spot, body, alignment, directLightFraction, horizon };
  return { ...partial, confirmed, note: noteFor(partial) };
}

/**
 * The single best answer to "where should I go tonight" — the weather-
 * confirmed opportunity happening soonest, across every kept spot and both
 * bodies. `null` when nothing kept is both due and confirmed clear, which is
 * the ordinary case: most alignments fall outside the forecast's reach and
 * most that don't will have cloud in the way. Ties (same instant) keep the
 * first spot in `opportunities`' own order.
 */
export function bestGoTonight(opportunities: GoTonightOpportunity[]): GoTonightOpportunity | null {
  const confirmed = opportunities.filter((o) => o.confirmed);
  if (!confirmed.length) return null;
  return confirmed.reduce((best, current) =>
    current.alignment.best.at.getTime() < best.alignment.best.at.getTime() ? current : best,
  );
}

/**
 * Where the "gate" forecast — the far sample `horizonReading` needs — should
 * be fetched from, for a spot's own kept bearing. Just `destination` plus
 * the same `√(2·R·h)` `weather.ts` already uses for the panel's own horizon
 * read: the physics does not change because the question is now "which of
 * several spots" instead of "this one".
 */
export function gatePointFor(spot: LatLon, bearing: number): LatLon {
  return destination(spot, bearing, horizonSampleDistanceM());
}
