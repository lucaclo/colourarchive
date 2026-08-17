/**
 * When does the sun set *behind that*?
 *
 * Every other answer in Scout starts from a moment and asks what the light is
 * doing. This one starts from a picture — the sun going down behind that summit,
 * the full moon coming up out of that notch — and asks which dates it happens on.
 * It is the question that makes someone drive somewhere, and until now the only
 * way to ask it here was to scrub a slider through three hundred and sixty five
 * days and watch.
 *
 * ## Why this can be better than the usual answer
 *
 * The planners that do offer this match an azimuth against a **flat** horizon:
 * "the sun sets at bearing 245° on 12 September". That is true and it is not the
 * answer, because a summit is not at the horizon — it stands some degrees above
 * it, and the sun reaches the bearing minutes before it reaches the *height*.
 * Scout already holds the real profile: `buildSkyline` measures what the
 * buildings block and `terrainHorizon` measures what the landscape blocks, and
 * `mergeHorizon` puts them together into one altitude for every bearing. Handed
 * that number, this module can say the sun meets the ridge rather than merely
 * crossing its compass point.
 *
 * The horizon altitude comes in as a plain number and is never fetched here, so
 * the caller owns its provenance. A flat 0° is a perfectly legitimate input — it
 * is what you have before any terrain loads — and it is a completely different
 * claim from a merged profile. The two must not be allowed to look alike in the
 * answer, which is why nothing in here invents one.
 *
 * ## Solved by scanning, and it is affordable
 *
 * Two crossings a day at most for the sun, and the crossing time drifts smoothly
 * from date to date, so a seeded walk would be cheaper. It would also be fragile
 * exactly where this is interesting — a branch that appears in April and vanishes
 * in September, an azimuth reached twice a day at one time of year and not at all
 * at another. So each day is scanned outright for sign changes of the gap between
 * the body's azimuth and the target bearing, and every one is bisected to the
 * second.
 *
 * Measured on this machine: `sunPosition` 0.246 µs a call, `moonPosition`
 * 0.523 µs. A year at the four-minute default is 131,400 samples — about 32 ms
 * for the sun and 68 ms for the moon, plus a few thousand bisection steps. That
 * is a button press, not a frame, and it buys robustness that nothing here has to
 * be careful about.
 *
 * **The one thing a scan misses**, written down rather than hidden: two crossings
 * closer together than the step look like none. That happens only at a turning
 * point of the azimuth, where the body reaches the bearing and turns back — and
 * the search reports that case as `no-bearing` carrying how close it came, which
 * is the honest description of a graze in any event.
 *
 * ## Refraction, and which altitude is the right one
 *
 * The apparent one. Refraction lifts the sun by more than its own width at the
 * horizon, so a geometric altitude would put a sunset four minutes early — and
 * this is a question about what you will see through a viewfinder, not about
 * where the light lands. Note that `isSunlit` in `skyline.ts` compares the
 * *geometric* altitude, and is right to: that one is about which surfaces the
 * beam reaches. Same sky, two questions, and they legitimately answer them
 * differently.
 *
 * Pure. No map, no DOM, no fetch, no clock of its own.
 */

import { angleDelta } from './frame';
import type { LatLon } from './geo';
import { moonIllumination, moonPosition, type MoonPhaseName } from './moon';
import { sunPosition } from './sun';

const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

/* ── Bodies ────────────────────────────────────────────────────────────────── */

/** Everything this module needs to know about something in the sky. */
export interface BodySample {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Apparent altitude of the centre, degrees — refraction applied. */
  altitude: number;
  /**
   * Half the disc's width, degrees.
   *
   * Carried per sample rather than as a constant because it genuinely moves: the
   * moon's varies by about a tenth between perigee and apogee, and it sets the
   * tolerance below, so a perigee moon really does get a slightly wider window
   * than an apogee one.
   */
  angularRadius: number;
}

export type BodySampler = (point: LatLon, at: Date) => BodySample;

/** Solar radius and the astronomical unit, km — the disc is derived, not tabulated. */
const SUN_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;

export const SUN: BodySampler = (point, at) => {
  const sun = sunPosition(point.lat, point.lon, at);
  return {
    azimuth: sun.azimuth,
    altitude: sun.altitudeApparent,
    angularRadius: Math.asin(SUN_RADIUS_KM / (sun.distanceAU * AU_KM)) * DEG,
  };
};

export const MOON: BodySampler = (point, at) => {
  const moon = moonPosition(point.lat, point.lon, at);
  return {
    azimuth: moon.azimuth,
    altitude: moon.altitudeApparent,
    angularRadius: moon.angularRadius,
  };
};

/* ── Crossings of a bearing ────────────────────────────────────────────────── */

export interface BearingCrossing {
  /** The instant the body's centre is exactly on the bearing. */
  at: Date;
  /** Apparent altitude of the centre then, degrees. */
  altitude: number;
  /** Half the disc, degrees, at that instant. */
  angularRadius: number;
  /** True when the body is on its way down through the crossing. */
  descending: boolean;
}

export interface CrossingScan {
  crossings: BearingCrossing[];
  /**
   * The smallest angle between the body and the bearing seen anywhere in the
   * window, and when. This is what explains an empty list: "it never gets closer
   * than 13° to that bearing from here" is an answer, and a bare zero rows is not.
   */
  closestGapDeg: number;
  closestGapAt: Date;
  samples: number;
}

/**
 * Four minutes is one degree of the earth's turn.
 *
 * Fine enough that a crossing is never mistaken for a graze at any latitude a
 * photograph gets taken at, and coarse enough that a year costs tens of
 * milliseconds rather than hundreds.
 */
export const DEFAULT_STEP_MINUTES = 4;

/** Milliseconds to stop bisecting at. A second is finer than any of this is true to. */
const REFINE_MS = 500;

/**
 * The instant inside a bracket where the gap changes sign.
 *
 * Plain bisection. Nine passes from a four-minute bracket land inside a second,
 * and Newton would need a derivative of the azimuth that is ill-conditioned in
 * exactly the place a crossing is most likely to be interesting — near the
 * zenith, where the azimuth swings arbitrarily fast.
 */
function refineCrossing(
  body: BodySampler,
  point: LatLon,
  bearing: number,
  loMs: number,
  hiMs: number,
): number {
  let lo = loMs;
  let hi = hiMs;
  let gapLo = angleDelta(bearing, body(point, new Date(lo)).azimuth);
  while (hi - lo > REFINE_MS) {
    const mid = (lo + hi) / 2;
    const gapMid = angleDelta(bearing, body(point, new Date(mid)).azimuth);
    if (gapMid === 0) return mid;
    if (Math.sign(gapMid) === Math.sign(gapLo)) {
      lo = mid;
      gapLo = gapMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Is the body rising or setting as it goes through the bearing?
 *
 * Read off half a minute either side rather than from a derivative, because the
 * two branches this separates — a body on the way up through a bearing and the
 * same body on the way down through it hours later — are different events on the
 * same day and must not be threaded into one series.
 */
function descendingAt(body: BodySampler, point: LatLon, atMs: number): boolean {
  const before = body(point, new Date(atMs - 30_000)).altitude;
  const after = body(point, new Date(atMs + 30_000)).altitude;
  return after < before;
}

/**
 * Every time the body's centre is on `bearing`, between two instants.
 *
 * A sign change of the gap is a crossing of the bearing — except at the far side
 * of the compass, where the same wrap happens as the body passes the *opposite*
 * bearing. The two are told apart by size: at a real crossing both samples are
 * near zero, at the antipodal wrap both are near 180.
 *
 * A sample that lands *exactly* on the bearing is its own crossing and is taken
 * as one, rather than being left to the sign test. Comparing `Math.sign` against
 * a zero counts one event twice — once going into the zero and once coming out
 * of it — which is why the last **non-zero** side is what gets carried forward.
 */
export function scanCrossings(
  body: BodySampler,
  point: LatLon,
  bearing: number,
  from: Date,
  to: Date,
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): CrossingScan {
  const stepMs = Math.max(1, stepMinutes) * 60_000;
  const endMs = to.getTime();
  const crossings: BearingCrossing[] = [];

  const record = (atMs: number) => {
    const at = new Date(Math.round(atMs));
    const sample = body(point, at);
    crossings.push({
      at,
      altitude: sample.altitude,
      angularRadius: sample.angularRadius,
      descending: descendingAt(body, point, atMs),
    });
  };

  let previousMs = from.getTime();
  let previousGap = angleDelta(bearing, body(point, from).azimuth);
  let lastSide = Math.sign(previousGap);
  let closestGapDeg = Math.abs(previousGap);
  let closestGapAt = from;
  let samples = 1;
  if (previousGap === 0) record(previousMs);

  for (let ms = previousMs + stepMs; ms <= endMs; ms += stepMs) {
    const here = new Date(ms);
    const gap = angleDelta(bearing, body(point, here).azimuth);
    const side = Math.sign(gap);
    samples++;
    if (Math.abs(gap) < closestGapDeg) {
      closestGapDeg = Math.abs(gap);
      closestGapAt = here;
    }

    // Both samples near zero is a crossing of the bearing; both near 180 is the
    // body going past the opposite one, which wraps the same way and is not.
    const nearTheBearing = Math.abs(gap) + Math.abs(previousGap) < 180;
    if (side === 0) {
      record(ms);
    } else if (lastSide !== 0 && side !== lastSide && nearTheBearing) {
      record(refineCrossing(body, point, bearing, previousMs, ms));
    }

    previousMs = ms;
    previousGap = gap;
    lastSide = side;
  }

  return { crossings, closestGapDeg, closestGapAt, samples };
}

/* ── Crossings of an altitude ──────────────────────────────────────────────── */

export interface AltitudeCrossing {
  /** The instant the body's centre is exactly at the target altitude. */
  at: Date;
  /** Where it is then, degrees clockwise from north. */
  azimuth: number;
  /** Half the disc, degrees, at that instant. */
  angularRadius: number;
  /** True when the body is climbing through the altitude, false when sinking. */
  ascending: boolean;
}

export interface AltitudeScan {
  crossings: AltitudeCrossing[];
  /** The smallest gap to the target altitude seen anywhere in the window, and when. */
  closestGapDeg: number;
  closestGapAt: Date;
  samples: number;
}

/**
 * Every time the body's centre is at `targetAltitude`, between two instants.
 *
 * Issue #49's free-form counterpart to `scanCrossings`: that one tracks the
 * gap to a *bearing*, which wraps at 360° and has to be told apart from the
 * antipodal point on the far side of the compass. Altitude does neither — it
 * runs from -90° to 90° and stops, so a sign change of `altitude −
 * targetAltitude` is always a real crossing and never needs the wrap check
 * `scanCrossings` carries. That is the whole of the difference; the sampling,
 * the bisection to the second, and the closest-gap bookkeeping for an empty
 * result are the same machinery, reused rather than rewritten.
 */
export function scanAltitudeCrossings(
  body: BodySampler,
  point: LatLon,
  targetAltitude: number,
  from: Date,
  to: Date,
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): AltitudeScan {
  const stepMs = Math.max(1, stepMinutes) * 60_000;
  const endMs = to.getTime();
  const crossings: AltitudeCrossing[] = [];

  const record = (atMs: number, ascending: boolean) => {
    const at = new Date(Math.round(atMs));
    const sample = body(point, at);
    crossings.push({ at, azimuth: sample.azimuth, angularRadius: sample.angularRadius, ascending });
  };

  const gapAt = (atMs: number) => body(point, new Date(atMs)).altitude - targetAltitude;

  let previousMs = from.getTime();
  let previousGap = gapAt(previousMs);
  let closestGapDeg = Math.abs(previousGap);
  let closestGapAt = from;
  let samples = 1;
  if (previousGap === 0) record(previousMs, true);

  for (let ms = previousMs + stepMs; ms <= endMs; ms += stepMs) {
    const gap = gapAt(ms);
    samples++;
    if (Math.abs(gap) < closestGapDeg) {
      closestGapDeg = Math.abs(gap);
      closestGapAt = new Date(ms);
    }

    if (gap === 0) {
      record(ms, gap >= previousGap);
    } else if (previousGap !== 0 && Math.sign(gap) !== Math.sign(previousGap)) {
      const atMs = refineAltitudeCrossing(body, point, targetAltitude, previousMs, ms);
      record(atMs, gap > previousGap);
    }

    previousMs = ms;
    previousGap = gap;
  }

  return { crossings, closestGapDeg, closestGapAt, samples };
}

/** The instant inside a bracket where the altitude gap changes sign. Plain bisection, as `refineCrossing`. */
function refineAltitudeCrossing(
  body: BodySampler,
  point: LatLon,
  targetAltitude: number,
  loMs: number,
  hiMs: number,
): number {
  let lo = loMs;
  let hi = hiMs;
  let gapLo = body(point, new Date(lo)).altitude - targetAltitude;
  while (hi - lo > REFINE_MS) {
    const mid = (lo + hi) / 2;
    const gapMid = body(point, new Date(mid)).altitude - targetAltitude;
    if (gapMid === 0) return mid;
    if (Math.sign(gapMid) === Math.sign(gapLo)) {
      lo = mid;
      gapLo = gapMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/* ── Alignments ────────────────────────────────────────────────────────────── */

export interface AlignmentCrossing extends BearingCrossing {
  /** Body minus horizon, degrees. Negative means it crosses already hidden. */
  clearanceDeg: number;
}

/** Why there is no alignment to report. */
export type AlignmentAbsence =
  /** The body never reaches that bearing from here at all. */
  | 'no-bearing'
  /** It reaches it, always with the horizon well below: it never goes behind. */
  | 'always-above'
  /** By the time it reaches the bearing it is already behind: you never see it. */
  | 'always-below'
  /** It passes both sides across the search, but never within a disc's width. */
  | 'never-quite';

export interface Alignment {
  /** The closest crossing of this pass — the date to go on. */
  best: AlignmentCrossing;
  /**
   * The consecutive dates whose disc touches the horizon line, closest first in
   * `best` and in time order here. Empty when even the closest misses.
   *
   * A run rather than a date because that is the truth of it: the disc has width
   * and the geometry drifts a fraction of a degree a day, so the shot is usually
   * on for two or three evenings. Reporting one date would be throwing the other
   * two away.
   */
  window: AlignmentCrossing[];
  /** True when `window` has anything in it. */
  meets: boolean;
  /**
   * True when the clearance changes sign across the pass — the body genuinely
   * crosses from in front of the sky to behind the horizon over those dates,
   * rather than merely coming close and retreating.
   */
  passesBehind: boolean;
  descending: boolean;
  /**
   * Set when the closest crossing is the first or last in the search window,
   * which means the pass was still improving when the search ran out and a
   * longer window may find a better date.
   *
   * Which end it is matters: at `'end'` the answer is "widen the search", at
   * `'start'` it is "this already happened, look behind you". Reporting both as
   * one flag sent the reader the wrong way half the time.
   */
  atSearchEdge: 'start' | 'end' | null;
  /** A clause for the row. The subject words belong to the caller. */
  note: string;
}

export interface AlignmentOptions {
  /** Degrees clockwise from north — where the thing you want it behind is. */
  bearing: number;
  /**
   * How high that thing stands, degrees above the horizontal. Zero is a flat sea
   * horizon, and saying so is the caller's job.
   */
  horizonDeg: number;
  from: Date;
  /** How far ahead to search, in days. */
  days: number;
  stepMinutes?: number;
  /**
   * How close counts as meeting, degrees.
   *
   * Left undefined it is the body's own angular radius at that instant, so
   * "meets" means the disc touches the line — a measurement rather than a
   * preference. A fixed number here would be exactly the unreproducible constant
   * this project refuses to publish about sunsets.
   */
  toleranceDeg?: number;
}

export interface AlignmentSearch {
  events: Alignment[];
  /** Null when at least one event's disc touches the line. */
  absence: AlignmentAbsence | null;
  bearing: number;
  horizonDeg: number;
  from: Date;
  to: Date;
  stepMinutes: number;
  /** How many times the body was on the bearing at all. */
  crossings: number;
  closestGapDeg: number;
  closestGapAt: Date;
  /** A whole sentence about the search, including why it found nothing. */
  note: string;
}

const round1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Whether this crossing's disc touches the horizon line. */
const touches = (crossing: AlignmentCrossing, toleranceDeg?: number): boolean =>
  Math.abs(crossing.clearanceDeg) <= (toleranceDeg ?? crossing.angularRadius);

function noteFor(event: Alignment): string {
  const off = Math.abs(event.best.clearanceDeg);
  const edge =
    event.atSearchEdge === 'end'
      ? ' · still closing when the search ended'
      : event.atSearchEdge === 'start'
        ? ' · already past its closest when the search began'
        : '';
  if (event.meets) {
    const nights =
      event.window.length > 1 ? ` · ${event.window.length} dates in a row` : '';
    const how = event.passesBehind ? 'passes behind' : 'grazes';
    return `${how}, disc on the line — ${round1(off)}° off centre${nights}${edge}`;
  }
  const side = event.best.clearanceDeg > 0 ? 'above' : 'below';
  return `closest approach: ${round1(off)}° ${side} it${edge}`;
}

/**
 * Find the dates the body meets the horizon on a bearing.
 *
 * The shape of the answer is a **pass**: one closest approach, with the run of
 * dates around it whose disc still touches. Passes are found as the local minima
 * of |clearance| along each branch, which is the same thing as "every time it
 * comes closest and then goes away again" — and which, unlike hunting only for
 * sign changes, still reports the near miss when a summit is never quite reached.
 * A near miss with a number is the answer to "why can I not get this shot"; an
 * empty list is not.
 *
 * The two branches — crossings on the way up and crossings on the way down — are
 * followed separately. They are different events that happen to share a compass
 * point, and interleaving them would turn one smooth series into a zigzag with
 * a fictitious minimum at every step.
 */
export function findAlignments(
  body: BodySampler,
  point: LatLon,
  options: AlignmentOptions,
): AlignmentSearch {
  const { bearing, horizonDeg, from, days, toleranceDeg } = options;
  const stepMinutes = options.stepMinutes ?? DEFAULT_STEP_MINUTES;
  const to = new Date(from.getTime() + Math.max(0, days) * DAY_MS);

  const scan = scanCrossings(body, point, bearing, from, to, stepMinutes);
  const all: AlignmentCrossing[] = scan.crossings.map((crossing) => ({
    ...crossing,
    clearanceDeg: crossing.altitude - horizonDeg,
  }));

  const events: Alignment[] = [];
  for (const descending of [true, false]) {
    const branch = all.filter((crossing) => crossing.descending === descending);
    events.push(...passesIn(branch, descending, toleranceDeg));
  }
  events.sort((a, b) => a.best.at.getTime() - b.best.at.getTime());

  const absence = absenceFor(events, all);
  return {
    events,
    absence,
    bearing,
    horizonDeg,
    from,
    to,
    stepMinutes,
    crossings: all.length,
    closestGapDeg: scan.closestGapDeg,
    closestGapAt: scan.closestGapAt,
    note: searchNote(events, all, absence, scan, bearing, horizonDeg, toleranceDeg),
  };
}

/** The local minima of |clearance| along one branch, with their windows. */
function passesIn(
  branch: AlignmentCrossing[],
  descending: boolean,
  toleranceDeg?: number,
): Alignment[] {
  const events: Alignment[] = [];
  const off = (index: number) => Math.abs(branch[index].clearanceDeg);

  for (let i = 0; i < branch.length; i++) {
    // A plateau keeps its first member: `<` looking back and `<=` looking
    // forward means an exact tie is reported once, not once per equal date.
    const fallsTo = i === 0 || off(i) < off(i - 1);
    const risesAfter = i === branch.length - 1 || off(i) <= off(i + 1);
    if (!fallsTo || !risesAfter) continue;

    let first = i;
    while (first > 0 && touches(branch[first - 1], toleranceDeg)) first--;
    let last = i;
    while (last < branch.length - 1 && touches(branch[last + 1], toleranceDeg)) last++;
    const window = touches(branch[i], toleranceDeg) ? branch.slice(first, last + 1) : [];

    // Whether it really goes behind, judged across the whole window plus the
    // date either side of it: a pass that touches on one date only still counts
    // if the neighbours it sits between are on opposite sides of the line.
    const low = Math.max(0, first - 1);
    const high = Math.min(branch.length - 1, last + 1);
    let sawAbove = false;
    let sawBelow = false;
    for (let k = low; k <= high; k++) {
      if (branch[k].clearanceDeg > 0) sawAbove = true;
      if (branch[k].clearanceDeg < 0) sawBelow = true;
    }

    const event: Alignment = {
      best: branch[i],
      window,
      meets: window.length > 0,
      passesBehind: sawAbove && sawBelow,
      descending,
      atSearchEdge: i === 0 ? 'start' : i === branch.length - 1 ? 'end' : null,
      note: '',
    };
    event.note = noteFor(event);
    events.push(event);
  }
  return events;
}

function absenceFor(events: Alignment[], all: AlignmentCrossing[]): AlignmentAbsence | null {
  if (!all.length) return 'no-bearing';
  if (events.some((event) => event.meets)) return null;
  const above = all.every((crossing) => crossing.clearanceDeg > 0);
  const below = all.every((crossing) => crossing.clearanceDeg < 0);
  if (above) return 'always-above';
  if (below) return 'always-below';
  return 'never-quite';
}

function searchNote(
  events: Alignment[],
  all: AlignmentCrossing[],
  absence: AlignmentAbsence | null,
  scan: CrossingScan,
  bearing: number,
  horizonDeg: number,
  toleranceDeg?: number,
): string {
  const there = `${round1(horizonDeg)}° up on ${Math.round(bearing)}°`;
  if (absence === 'no-bearing') {
    return `It never reaches ${Math.round(bearing)}° from here — the closest it comes is ${round1(
      scan.closestGapDeg,
    )}° off that bearing.`;
  }

  const nearest = all.reduce((best, crossing) =>
    Math.abs(crossing.clearanceDeg) < Math.abs(best.clearanceDeg) ? crossing : best,
  );
  const gap = round1(Math.abs(nearest.clearanceDeg));

  if (absence === 'always-above') {
    return `It crosses that bearing every time, always clear of what is there (${there}) — never closer than ${gap}° above. It does not go behind it in this window.`;
  }
  if (absence === 'always-below') {
    return `By the time it reaches that bearing it is already behind what is there (${there}) — never closer than ${gap}° below. You would not see it in this window.`;
  }
  if (absence === 'never-quite') {
    // Name the tolerance when the caller chose one. "Never within a disc's
    // width" is a claim about the sky; "never within 0.05°" is a claim about a
    // setting, and reading the second as the first would be badly misleading.
    const within = toleranceDeg == null ? "a disc's width" : `${round1(toleranceDeg)}°`;
    return `It passes either side of ${there} across this window but never within ${within} — the nearest is ${gap}°.`;
  }

  const meeting = events.filter((event) => event.meets);
  const dates = meeting.reduce((total, event) => total + event.window.length, 0);
  return `${meeting.length} pass${meeting.length === 1 ? '' : 'es'} where the disc meets ${there}, on ${dates} date${
    dates === 1 ? '' : 's'
  }.`;
}

/**
 * The pass that came nearest, met or not.
 *
 * What a refusal has to carry. "The nearest it gets is 1.2° short, on 21 June"
 * tells you to look for a different spot or a taller one; "no alignments" tells
 * you nothing and reads as a broken search. Null only when the body never
 * reached the bearing at all, which `absence` names as `no-bearing`.
 */
export function closestPass(search: AlignmentSearch): Alignment | null {
  if (!search.events.length) return null;
  return search.events.reduce((best, event) =>
    Math.abs(event.best.clearanceDeg) < Math.abs(best.best.clearanceDeg) ? event : best,
  );
}

/* ── The moon's phase, carried per event ───────────────────────────────────── */

export interface MoonAlignment extends Alignment {
  /** Lit fraction of the disc at that instant, 0–1. */
  fraction: number;
  phase: MoonPhaseName;
  waxing: boolean;
}

/**
 * The same passes, each carrying how much of the moon is lit.
 *
 * The moon crosses any bearing about once a day, so a year's search returns
 * hundreds of crossings and a pass most months. Handed over flat that is worse
 * than useless — it buries the four or five nights anyone wants. What separates
 * them is the phase: the full moon coming up behind the hill is the photograph,
 * and the same alignment under a 12% waning crescent an hour before dawn is a
 * different event that is not worth the drive.
 *
 * Sorted by nothing new and filtered by nothing at all. Which fraction is worth
 * going out for is the reader's call, and the control that makes it belongs in
 * the panel where it can be seen and moved.
 */
export function withMoonPhase(events: Alignment[]): MoonAlignment[] {
  return events.map((event) => {
    const illumination = moonIllumination(event.best.at);
    return {
      ...event,
      fraction: illumination.fraction,
      phase: illumination.name,
      waxing: illumination.waxing,
    };
  });
}

/**
 * The free-form query issue #49 asks for: every time the moon is at a given
 * altitude, each carrying how much of it is lit — "when is the moon at 15°
 * and over 80% illuminated", with no target bearing at all.
 *
 * `findAlignments` answers "when does it pass behind *that*", which needs a
 * bearing chosen on the map before it means anything. Not every shot has one
 * yet: sometimes the height and the phase are the whole of the plan, and the
 * compass point is whatever the ground offers on the night. `scanAltitudeCrossings`
 * is the search this needs; this is that search with the same illumination
 * enrichment `withMoonPhase` already does, so filtering "over 80% lit" is a
 * plain array filter on the result, in the panel, the same way it already is
 * for the bearing search — see that function's own note on why the fraction
 * threshold belongs to the reader and not to this module.
 */
export interface MoonAltitudeCrossing extends AltitudeCrossing {
  fraction: number;
  phase: MoonPhaseName;
  waxing: boolean;
}

export function withMoonPhaseAt(crossings: AltitudeCrossing[]): MoonAltitudeCrossing[] {
  return crossings.map((crossing) => {
    const illumination = moonIllumination(crossing.at);
    return {
      ...crossing,
      fraction: illumination.fraction,
      phase: illumination.name,
      waxing: illumination.waxing,
    };
  });
}
