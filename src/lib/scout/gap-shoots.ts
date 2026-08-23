/**
 * When and where a missing colour is actually reachable.
 *
 * The archive side (`gaps.ts`) says *what* is missing — a hue anchor with no
 * chapter, or a thin one. This module answers the question that inverts the
 * usual Scout flow: instead of checking a place and date and reading off the
 * light, it starts from a colour and asks the atmosphere model
 * (`light-locus.ts`) which altitude would produce it, then asks the sun
 * engine (`scanAltitudeCrossings`, from `alignment.ts`) every date in the
 * next year that a given point actually sees the sun at that altitude.
 *
 * One altitude, not a fuzzed band — the same choice `alignment.ts` makes for
 * a bearing: a single reproducible number beats a range nothing here can
 * verify. And it inherits that module's honesty about absence — a spot far
 * enough north that the sun never dips to a sunset altitude in midsummer
 * gets told exactly that, not a silently empty list.
 *
 * Pure. No map, no DOM, no fetch, no clock of its own — same discipline as
 * everything else it's built from.
 */

import { SUN, scanAltitudeCrossings } from './alignment';
import type { LatLon } from './geo';
import { matchHueToLight, type LightMatch } from './light-locus';
import type { ColourGap } from '../gaps';

const DAY_MS = 86_400_000;

export interface GapOccurrence {
  /** The instant the sun is at the matched altitude, from this point. */
  at: Date;
  /** Where it is then, degrees clockwise from north. */
  azimuth: number;
  /** True for a morning-side crossing (sun climbing), false for evening (sinking). */
  ascending: boolean;
}

export interface GapShoot {
  gap: ColourGap;
  /** Null when the hue isn't one daylight scattering produces — see `light-locus.ts`. */
  match: LightMatch | null;
  /** Every occurrence in the search window, soonest first. */
  occurrences: GapOccurrence[];
  /** One sentence for the panel — recipe and timing, or the honest refusal. */
  note: string;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

function describeWhen(occurrences: GapOccurrence[], point: LatLon, altitudeDeg: number, days: number): string {
  if (occurrences.length === 0) {
    return `never reaches ${round1(altitudeDeg)}° from here in the next ${days} days`;
  }
  const next = occurrences[0];
  const side = next.ascending ? 'sunrise side' : 'sunset side';
  const span = days >= 300 ? `${occurrences.length}× over the next year` : `${occurrences.length}× in the next ${days} days`;
  return `next on ${next.at.toISOString().slice(0, 10)}, ${side} — ${span}`;
}

/**
 * A missing colour, turned into a shoot — or the honest reason there isn't
 * one, for one point and the year ahead of `from`.
 */
export function suggestShootForGap(
  gap: ColourGap,
  point: LatLon,
  from: Date,
  days = 365,
): GapShoot {
  const match = matchHueToLight(gap.targetHue);
  if (!match) {
    return {
      gap,
      match: null,
      occurrences: [],
      note: `${gap.anchorName} isn't a colour daylight itself makes — it needs the right subject in frame, not different light.`,
    };
  }

  const to = new Date(from.getTime() + days * DAY_MS);
  const scan = scanAltitudeCrossings(SUN, point, match.point.altitudeDeg, from, to);
  const occurrences: GapOccurrence[] = scan.crossings
    .map((c) => ({ at: c.at, azimuth: c.azimuth, ascending: c.ascending }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const when = describeWhen(occurrences, point, match.point.altitudeDeg, days);
  const note =
    `${match.point.environment.label}, sun near ${round1(match.point.altitudeDeg)}° ` +
    `(${round1(match.hueDeltaDeg)}° off ${gap.anchorName.toLowerCase()}) — ${when}.`;

  return { gap, match, occurrences, note };
}

/** `suggestShootForGap` for every gap, in the order given. */
export function suggestShootsForGaps(
  gaps: ColourGap[],
  point: LatLon,
  from: Date,
  days = 365,
): GapShoot[] {
  return gaps.map((gap) => suggestShootForGap(gap, point, from, days));
}
