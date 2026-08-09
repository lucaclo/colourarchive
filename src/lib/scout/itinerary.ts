/**
 * A day of shooting, not a place.
 *
 * Every other answer in Scout is about one coordinate. A day is several, and
 * the thing that makes it hard is that the two constraints come from different
 * places and do not negotiate: each spot's light is fixed by the sun, and the
 * time to get between them is fixed by geography. Ordering half a dozen spots
 * by hand against both is exactly the arithmetic a computer should be doing.
 *
 * ## What "best light" means here
 *
 * The **lowest the sun gets while the spot is still lit**. Not a preference
 * setting and not a golden-hour constant: it is read off the same per-spot
 * light windows the panel already draws, crossed with the same day track the
 * slider already holds, so the itinerary cannot disagree with the page it was
 * built from. A spot with no lit window has no best light and is reported as
 * having none rather than scheduled at an arbitrary hour.
 *
 * ## Why it searches every order
 *
 * Six spots is 720 orderings, which is nothing, so there is no reason to accept
 * the approximate answer a greedy walk would give. The search is exhaustive and
 * the result is exact for the model — and being exact matters because the
 * failure it exists to report is a *near miss*: "you cannot make it from the
 * castle to the shore in time" is only true if no ordering could.
 *
 * ## It reports rather than tidies
 *
 * A spot that cannot be fitted is listed as dropped, with the reason. Two spots
 * whose best light falls at the same time are reported as a clash **even when
 * the plan works**, because a plan that quietly moved one of them off its best
 * light has answered a different question from the one that was asked. This is
 * the same rule `report.ts` follows for an absent sunrise: an absent thing is
 * listed as absent.
 */

import { distance, type LatLon } from './geo';

/** A run of the day during which the spot is lit, or is not. */
export interface LitWindow {
  lit: boolean;
  /** Minute index into the day, inclusive. */
  startMinute: number;
  /** Minute index into the day, exclusive. */
  endMinute: number;
}

/** Just enough of a sun sample to choose the best light. */
export interface AltitudeSample {
  altitude: number;
}

export interface ItinerarySpot {
  /** What the notebook calls it. Also its identity in the plan. */
  name: string;
  at: LatLon;
  /**
   * The spot's own day, from `lightWindows()`.
   *
   * Passed in rather than computed here so this module stays pure and so the
   * plan is built from the identical windows the panel and the pins use.
   */
  windows: LitWindow[];
}

/**
 * How many spots the exhaustive search will order.
 *
 * Six is 720 permutations. Seven would be 5,040 and eight 40,320 — still fast,
 * but the cap is not really about speed: past half a dozen stops a day plan is
 * a fiction, because the estimate below compounds at every leg.
 */
export const MAX_ITINERARY_SPOTS = 6;
/** Below two there is no ordering problem and no travel to check. */
export const MIN_ITINERARY_SPOTS = 2;

export interface ItineraryOptions {
  /** Minutes spent at each spot. */
  dwellMinutes: number;
  /** Assumed travel speed over straight-line distance, km/h. */
  speedKmh: number;
  /** Earliest minute of the day the plan may use. Default 0. */
  fromMinute?: number;
  /** Latest minute the plan may run to. Default 1440. */
  toMinute?: number;
}

export interface ItineraryStop {
  spot: ItinerarySpot;
  arriveMinute: number;
  leaveMinute: number;
  /** Straight-line metres from the previous stop; 0 at the first. */
  travelM: number;
  /** Minutes allowed for that move, rounded up. */
  travelMinutes: number;
  /** The minute this spot's light is at its best. */
  bestMinute: number;
  /**
   * How far the visit lands from that best minute. Zero is the ideal, and a
   * large number is the honest cost of fitting everything else in.
   */
  offBestMinutes: number;
  /** The sun's altitude on arrival — the fact underneath "best light". */
  sunAltitude: number;
}

export type DropReason = 'never-lit' | 'no-room' | 'over-the-limit';

export interface ItineraryDrop {
  spot: ItinerarySpot;
  reason: DropReason;
  /** A whole sentence, so the UI never has to translate the enum. */
  note: string;
}

export type ConflictKind = 'peaks-together' | 'unreachable';

export interface ItineraryConflict {
  kind: ConflictKind;
  note: string;
}

export interface Itinerary {
  stops: ItineraryStop[];
  dropped: ItineraryDrop[];
  /** Reported even when the plan succeeded. See this file's header. */
  conflicts: ItineraryConflict[];
  totalTravelM: number;
  totalTravelMinutes: number;
  /** The assumption behind every travel number, for the UI to print verbatim. */
  travelAssumption: string;
}

/**
 * How close two bests have to be to count as clashing.
 *
 * Set from the dwell, not from taste: if two spots peak within one stay of each
 * other you cannot be at both for their best light, whatever the route does.
 * So the rule is derived from the plan's own numbers and moves with them.
 */
const clashWindow = (dwellMinutes: number) => Math.max(10, dwellMinutes);

/** Straight-line travel time, rounded up — a part-minute is a minute you need. */
function travelMinutesBetween(a: LatLon, b: LatLon, speedKmh: number): number {
  const metres = distance(a, b);
  if (!(speedKmh > 0)) return Number.POSITIVE_INFINITY;
  return Math.ceil((metres / 1000 / speedKmh) * 60);
}

/**
 * The minute a spot's light is at its best, and the sun's altitude there.
 *
 * The lowest the sun gets while the spot is lit. Ties go to the later minute:
 * a spot lit equally at dawn and dusk is more often wanted in the evening, and
 * an arbitrary tie has to break somewhere — this is at least a stated reason
 * rather than an artefact of the scan direction.
 *
 * Returns null when no lit minute has the sun above the horizon at all, which
 * is a real condition — a courtyard that only ever sees the sky at night, or a
 * polar winter — and not an error.
 */
export function bestLightMinute(
  windows: LitWindow[],
  samples: AltitudeSample[],
): { minute: number; altitude: number } | null {
  let best: { minute: number; altitude: number } | null = null;
  for (const window of windows) {
    if (!window.lit) continue;
    for (let minute = window.startMinute; minute < window.endMinute; minute++) {
      const sample = samples[minute];
      if (!sample || !(sample.altitude > 0)) continue;
      if (!best || sample.altitude <= best.altitude) {
        best = { minute, altitude: sample.altitude };
      }
    }
  }
  return best;
}

/** Every lit window with room for a stay of `dwellMinutes`, in order. */
function usableWindows(windows: LitWindow[], dwellMinutes: number): LitWindow[] {
  return windows.filter((w) => w.lit && w.endMinute - w.startMinute >= dwellMinutes);
}

/**
 * The earliest a stay of `dwellMinutes` can start at or after `from`.
 *
 * Null when this spot has no lit window left that can hold one — which is what
 * makes an ordering infeasible rather than merely poor.
 */
function earliestStart(
  windows: LitWindow[],
  from: number,
  dwellMinutes: number,
  until: number,
): number | null {
  for (const window of windows) {
    const start = Math.max(window.startMinute, from);
    if (start + dwellMinutes > window.endMinute) continue;
    if (start + dwellMinutes > until) continue;
    return start;
  }
  return null;
}

/** Every ordering of `items`. Only ever called with six or fewer. */
function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

interface Candidate {
  stops: ItineraryStop[];
  scheduled: number;
  offBest: number;
  travelM: number;
}

/**
 * Try one ordering, scheduling each stop as early as its light allows.
 *
 * Earliest-feasible rather than best-fit on purpose: it is the only rule that
 * cannot strand a later spot to flatter an earlier one, and with every ordering
 * being tried anyway, the search finds the good arrangement — the scheduler does
 * not have to be clever as well.
 */
function schedule(
  order: ItinerarySpot[],
  bests: Map<string, { minute: number; altitude: number }>,
  samples: AltitudeSample[],
  options: Required<ItineraryOptions>,
): Candidate | null {
  const stops: ItineraryStop[] = [];
  let clock = options.fromMinute;
  let previous: LatLon | null = null;
  let travelM = 0;
  let offBest = 0;

  for (const spot of order) {
    const travelDistance = previous ? distance(previous, spot.at) : 0;
    const travel = previous ? travelMinutesBetween(previous, spot.at, options.speedKmh) : 0;
    if (!Number.isFinite(travel)) return null;

    const start = earliestStart(
      usableWindows(spot.windows, options.dwellMinutes),
      clock + travel,
      options.dwellMinutes,
      options.toMinute,
    );
    // One spot that cannot be placed kills the ordering, not the plan: another
    // ordering may hold it, and only if none does is the spot really dropped.
    if (start === null) return null;

    const best = bests.get(spot.name);
    stops.push({
      spot,
      arriveMinute: start,
      leaveMinute: start + options.dwellMinutes,
      travelM: Math.round(travelDistance),
      travelMinutes: travel,
      bestMinute: best ? best.minute : start,
      offBestMinutes: best ? Math.abs(start - best.minute) : 0,
      sunAltitude: samples[start]?.altitude ?? 0,
    });

    offBest += best ? Math.abs(start - best.minute) : 0;
    travelM += travelDistance;
    clock = start + options.dwellMinutes;
    previous = spot.at;
  }

  return { stops, scheduled: stops.length, offBest, travelM };
}

/**
 * Order a handful of spots into a day.
 *
 * The objective, in the order it is applied and in plain words, because a
 * ranking nobody can reproduce is exactly what this project refuses to publish:
 *
 * 1. **Fit the most spots.** A plan that reaches five places beats one that
 *    reaches four in better light.
 * 2. **Then land closest to each spot's own best light**, summed over the day.
 *    This is what makes it an itinerary rather than a travelling-salesman route.
 * 3. **Then travel least**, which only ever separates plans that are otherwise
 *    identical.
 *
 * No weights, no score. Each step is a total order on its own number.
 */
export function planItinerary(
  spots: ItinerarySpot[],
  samples: AltitudeSample[],
  options: ItineraryOptions,
): Itinerary {
  const settings: Required<ItineraryOptions> = {
    fromMinute: 0,
    toMinute: 1440,
    ...options,
  };

  const dropped: ItineraryDrop[] = [];
  const conflicts: ItineraryConflict[] = [];

  // A cap that silently truncated would report a complete-looking plan for an
  // incomplete set of spots. Say what was left out.
  const considered = spots.slice(0, MAX_ITINERARY_SPOTS);
  for (const spot of spots.slice(MAX_ITINERARY_SPOTS)) {
    dropped.push({
      spot,
      reason: 'over-the-limit',
      note: `${spot.name} is past the ${MAX_ITINERARY_SPOTS}-spot limit and was not ordered.`,
    });
  }

  // Best light first: it decides both which spots can be planned at all and
  // which ones clash.
  const bests = new Map<string, { minute: number; altitude: number }>();
  const schedulable: ItinerarySpot[] = [];
  for (const spot of considered) {
    const best = bestLightMinute(spot.windows, samples);
    if (!best || !usableWindows(spot.windows, settings.dwellMinutes).length) {
      dropped.push({
        spot,
        reason: 'never-lit',
        note: best
          ? `${spot.name} has no stretch of direct sun long enough for ${settings.dwellMinutes} minutes.`
          : `${spot.name} gets no direct sun on this date.`,
      });
      continue;
    }
    bests.set(spot.name, best);
    schedulable.push(spot);
  }

  // Clashes are a property of the light alone, so they are found before any
  // route is tried and reported whether or not one succeeds.
  const clash = clashWindow(settings.dwellMinutes);
  for (let i = 0; i < schedulable.length; i++) {
    for (let j = i + 1; j < schedulable.length; j++) {
      const a = bests.get(schedulable[i].name);
      const b = bests.get(schedulable[j].name);
      if (!a || !b) continue;
      if (Math.abs(a.minute - b.minute) < clash) {
        conflicts.push({
          kind: 'peaks-together',
          note: `${schedulable[i].name} and ${schedulable[j].name} are both at their best within ${clash} minutes of each other — you can have one of them at its best, not both.`,
        });
      }
    }
  }

  let best: Candidate | null = null;
  for (const order of permutations(schedulable)) {
    const candidate = schedule(order, bests, samples, settings);
    if (!candidate) continue;
    if (
      !best ||
      candidate.scheduled > best.scheduled ||
      (candidate.scheduled === best.scheduled &&
        (candidate.offBest < best.offBest ||
          (candidate.offBest === best.offBest && candidate.travelM < best.travelM)))
    ) {
      best = candidate;
    }
  }

  // Nothing fitted as a whole. Rather than report an empty day, fall back to
  // the best arrangement of every proper subset — which is what turns "this
  // cannot be done" into "this can, without the shore".
  if (!best && schedulable.length) {
    for (let drop = 1; drop < schedulable.length && !best; drop++) {
      for (const subset of combinations(schedulable, schedulable.length - drop)) {
        for (const order of permutations(subset)) {
          const candidate = schedule(order, bests, samples, settings);
          if (!candidate) continue;
          if (
            !best ||
            candidate.offBest < best.offBest ||
            (candidate.offBest === best.offBest && candidate.travelM < best.travelM)
          ) {
            best = candidate;
          }
        }
      }
    }
  }

  const stops = best?.stops ?? [];
  const placed = new Set(stops.map((stop) => stop.spot.name));
  for (const spot of schedulable) {
    if (placed.has(spot.name)) continue;
    dropped.push({
      spot,
      reason: 'no-room',
      note: `${spot.name} could not be reached in time from anywhere else in the day, in any order.`,
    });
    conflicts.push({
      kind: 'unreachable',
      note: `No ordering fits ${spot.name} between the others and still meets its light.`,
    });
  }

  const totalTravelMinutes = stops.reduce((sum, stop) => sum + stop.travelMinutes, 0);
  return {
    stops,
    dropped,
    conflicts,
    totalTravelM: Math.round(stops.reduce((sum, stop) => sum + stop.travelM, 0)),
    totalTravelMinutes,
    travelAssumption: `Travel is straight-line distance at ${settings.speedKmh} km/h, plus ${settings.dwellMinutes} minutes at each spot. Real routes are longer — treat every move as a lower bound.`,
  };
}

/** Every subset of `items` of exactly size `size`. Only used for tiny sets. */
function combinations<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  return [
    ...combinations(rest, size - 1).map((tail) => [head, ...tail]),
    ...combinations(rest, size),
  ];
}
