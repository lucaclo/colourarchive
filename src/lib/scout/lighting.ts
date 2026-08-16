/**
 * Which way the light falls across a shot.
 *
 * This is the half of the join that was missing. Scout could already answer
 * *whether* the sun reaches a place — that is `skyline.ts`, and it is exact
 * geometry. What it could not answer is the question a photographer actually
 * asks next: with the sun over there and the camera pointing this way, is the
 * subject lit from the front, the side or behind? Those are three completely
 * different photographs of the same place at the same minute.
 *
 * ## One angle, one definition
 *
 * Everything here comes from a single measured quantity: the angle between
 * where the camera points and where the sun is, `angleDelta(aim, azimuth)`.
 * Zero means the camera is pointing straight at the sun; 180° means the sun is
 * directly behind the photographer. Every label below is a band on that one
 * number, and every sentence prints that one number, so a reader who disagrees
 * with a label can check the arithmetic that produced it.
 *
 * ## It refuses more often than it answers
 *
 * A direction requires two things this module cannot invent: direct sun on the
 * spot, and a bearing for the camera. Both are frequently absent —
 * `RawPhoto.bearing` is undefined for every photograph Wikimedia Commons
 * returns, because Commons does not expose `GPSImgDirection` — and the
 * absence is reported as an absence rather than filled in with a plausible
 * guess. A front/back-lit verdict computed from a bearing nobody measured
 * would be a fabrication dressed as geometry, and it would be wrong about
 * half the time while looking exactly as confident as a correct one.
 *
 * So: sun below the horizon, spot in shade, or aim unknown each produce a
 * `direction` of `null` and an `absence` saying which. Only the fourth case
 * produces a verdict.
 */

import { angleDelta } from './frame';

/**
 * Where the light comes from, relative to the camera.
 *
 * `rim` is not a fifth position — it is `back` under a low sun, kept separate
 * because it is the one a photographer travels for. Grouping it with back-light
 * would bury it.
 */
export type LightDirection = 'front' | 'side' | 'back' | 'rim';

/** Why there is no direction to report. */
export type NoDirection =
  /** The sun is below the horizon: there is no beam to have a direction. */
  | 'sun-down'
  /** The sun is up but something blocks it here — the skyline says so. */
  | 'in-shadow'
  /** Direct sun, but nobody recorded which way the camera pointed. */
  | 'aim-unknown';

/**
 * The band edges, in degrees off the aim.
 *
 * Chosen as the even three-way split of the half-circle rather than fitted to
 * anything: light is called side-light across the whole middle third, and the
 * boundaries are conventions, not measurements. Naming them here means the
 * convention is visible and arguable instead of buried in two comparisons.
 */
export const BACK_LIT_MAX_DEG = 45;
export const FRONT_LIT_MIN_DEG = 135;

/**
 * How low the sun must be for back-light to be called rim-light.
 *
 * Ten degrees is about the last forty minutes before sunset at temperate
 * latitudes. Above it the sun is behind the subject but high, which flattens
 * the edge rather than drawing it.
 */
export const RIM_LIT_MAX_ALTITUDE_DEG = 10;

export interface LightingInput {
  /**
   * Where the camera points, degrees clockwise from north.
   *
   * Undefined means unknown, and unknown is reported rather than defaulted.
   */
  aimBearing?: number;
  sunAzimuth: number;
  /** Degrees above the horizon; at or below zero there is no direct light. */
  sunAltitude: number;
  /**
   * Whether direct sun actually reaches the spot.
   *
   * Supplied by the caller from `isSunlit`, so this module never has a second
   * opinion about shade — there is one answer and `skyline.ts` owns it.
   */
  lit: boolean;
}

export interface Lighting {
  /** Null whenever `absence` is set. */
  direction: LightDirection | null;
  /** Null whenever `direction` is set. Exactly one of the two is non-null. */
  absence: NoDirection | null;
  /**
   * Signed degrees from the aim to the sun; positive with the sun to the right
   * of frame. Null when the aim is unknown — but present for a shaded spot
   * with a known aim, because the geometry is still true, it is only the light
   * that is missing.
   */
  offsetDeg: number | null;
  /** Which side of the frame the sun is on. Null when it is near either axis end. */
  side: 'left' | 'right' | null;
  /** A whole clause, for the panel and the list. */
  note: string;
}

const round = (v: number) => Math.round(v);

/**
 * Classify the light on a spot at one instant.
 *
 * Pure, cheap, and safe to call per spot per slider minute — it is a subtract
 * and three comparisons, which is why the expensive half (the skyline) is
 * computed once per place and this is computed every time the slider moves.
 */
export function describeLighting(input: LightingInput): Lighting {
  const { aimBearing, sunAzimuth, sunAltitude, lit } = input;

  const offsetDeg =
    aimBearing == null || !Number.isFinite(aimBearing)
      ? null
      : angleDelta(aimBearing, sunAzimuth);
  // Reported for its own sake, so it survives the refusals below: knowing the
  // sun will be 8° off your aim is useful even while the spot is in shade.
  const side = offsetDeg == null ? null : offsetDeg > 0 ? 'right' : offsetDeg < 0 ? 'left' : null;

  const absent = (absence: NoDirection, note: string): Lighting => ({
    direction: null,
    absence,
    offsetDeg,
    side,
    note,
  });

  // Order matters, and it is the order of how badly each one bites. A spot
  // whose aim is unknown at midnight is not an aim problem.
  if (!(sunAltitude > 0)) return absent('sun-down', 'the sun is down');
  if (!lit) return absent('in-shadow', 'in shadow');
  if (offsetDeg == null) return absent('aim-unknown', 'lit, but the aim was never recorded');

  const off = Math.abs(offsetDeg);
  const hand = side === 'right' ? ' from the right' : side === 'left' ? ' from the left' : '';

  if (off <= BACK_LIT_MAX_DEG) {
    if (sunAltitude <= RIM_LIT_MAX_ALTITUDE_DEG) {
      return {
        direction: 'rim',
        absence: null,
        offsetDeg,
        side,
        note: `rim-lit · sun ${round(off)}° off aim, ${round(sunAltitude)}° up`,
      };
    }
    return {
      direction: 'back',
      absence: null,
      offsetDeg,
      side,
      note: `back-lit · sun ${round(off)}° off aim`,
    };
  }

  if (off >= FRONT_LIT_MIN_DEG) {
    return {
      direction: 'front',
      absence: null,
      offsetDeg,
      side,
      note: `front-lit · sun ${round(off)}° off aim`,
    };
  }

  return {
    direction: 'side',
    absence: null,
    offsetDeg,
    side,
    note: `side-lit${hand} · sun ${round(off)}° off aim`,
  };
}

/* ── Ranking ───────────────────────────────────────────────────────────────── */

/**
 * A spot, reduced to what the ordering is allowed to look at.
 *
 * Deliberately four plain facts rather than a score. The project already
 * refuses to publish a sunset number because nobody can reproduce one, and a
 * "best spot: 8.4" would be the same failure indoors: it hides which fact
 * moved the ranking and invites the reader to trust a weighting they cannot
 * see. This orders by stated criteria in a stated priority, and the list is
 * expected to print the criteria beside each row.
 */
export interface RankableSpot {
  /** Direct sun reaches it at the current minute. */
  lit: boolean;
  /**
   * Whether the buildings around this spot were actually loaded.
   *
   * Ranked on, and ranked on *early*, because of a bias found by driving the
   * real page rather than by reasoning about it: a spot with no buildings
   * loaded has nothing to put it in shade, so it reports more light than a
   * spot that was properly examined, and sorting on light alone floated every
   * least-known spot to the top of the list. Eight of eight rows over
   * Edinburgh were terrain-only. Confidence has to outrank the quantity it
   * inflates, or the ranking rewards ignorance.
   */
  buildingsKnown: boolean;
  /**
   * Minutes of direct sun still to come today, from now.
   *
   * A spot lit for four more hours and one about to lose the sun are not the
   * same offer, and for a photographer walking there the difference decides it.
   */
  litMinutesAhead: number;
  /** How many photographs found the place worth it. A weak signal, but a real one. */
  count: number;
  /** Metres from the pin, the tie-break: nearer is easier to reach. */
  distanceM: number;
}

/**
 * Order spots for the "best right now" list.
 *
 * Lit beats shaded; a spot whose surroundings are known beats one whose are
 * not; then more remaining light, then more photographs, then nearer. Each
 * comparison is total and none is weighted against another, so the order is
 * reproducible by hand from the facts printed on each row.
 */
export function compareSpots(a: RankableSpot, b: RankableSpot): number {
  if (a.lit !== b.lit) return a.lit ? -1 : 1;
  if (a.buildingsKnown !== b.buildingsKnown) return a.buildingsKnown ? -1 : 1;
  if (a.litMinutesAhead !== b.litMinutesAhead) return b.litMinutesAhead - a.litMinutesAhead;
  if (a.count !== b.count) return b.count - a.count;
  return a.distanceM - b.distanceM;
}

/**
 * Minutes of direct sun still ahead today, from `minute`.
 *
 * Counted off the windows the skyline already produced rather than re-sampled,
 * so it cannot disagree with the shade drawn on the slider track. A window
 * straddling `minute` contributes only its remainder.
 */
export function litMinutesAhead(
  windows: Array<{ lit: boolean; startMinute: number; endMinute: number }>,
  minute: number,
): number {
  let total = 0;
  for (const window of windows) {
    if (!window.lit || window.endMinute <= minute) continue;
    total += window.endMinute - Math.max(window.startMinute, minute);
  }
  return total;
}
