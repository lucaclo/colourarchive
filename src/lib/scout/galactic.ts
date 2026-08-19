/**
 * The galactic core: where it is, and when it is up in real darkness.
 *
 * The sister of `sun.ts` and `moon.ts`, built to the same rules — pure
 * functions of (latitude, longitude, instant), no map, no network, no clock of
 * its own.
 *
 * The question this answers is not "where is the Milky Way", which is always
 * overhead somewhere, but the one a photographer actually has: *is the bright
 * part of it above my horizon at a time when the sky is genuinely dark and the
 * moon is not up?* Those three conditions are independent, they are each
 * satisfied for a few hours at a time, and their intersection is often empty —
 * which is why a tool that reports only the first of them is no use. From
 * Britain the core clears the horizon by about five degrees at best, so most of
 * the honest answers here are refusals.
 *
 * **What is being pointed at.** The core is a region, not a point: the visually
 * bright part around Sagittarius spans something like fifteen degrees
 * (`CORE_SPAN_DEG`). This module tracks Sgr A*, the galactic centre itself,
 * because it is a defined coordinate rather than a matter of taste. Treat every
 * altitude as the middle of something much larger than the number's precision
 * suggests.
 *
 * **Light pollution.** The issue this was originally written for deliberately
 * left Bortle and SQM data out — no source of it publishes with CORS headers
 * for a live fetch — so for a while this module could only say when the *sky*
 * was dark, and the panel had to warn that this was not the same as "you will
 * see it". Issue #46 closed that gap without a live dependency at all: light
 * pollution barely moves night to night, so `light-pollution.ts` bundles one
 * static raster instead. `coreNight` below takes the zone as a plain number —
 * this module still touches no map and no network — leaving the fetch and
 * decode to `view/light-pollution-loader.ts`, same as every other pure/impure
 * split in this project.
 */

import { julianDay, refraction, SUN_ALTITUDE, sunPosition } from './sun';
import { greenwichSiderealTime, moonPosition, MOONRISE_ALTITUDE } from './moon';
import { lightPollutionDarkEnough, ZONE_COUNT } from './light-pollution';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const J2000 = 2451545.0;
const JULIAN_CENTURY_DAYS = 36525;

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

/**
 * Sagittarius A*, J2000.0: RA 17h 45m 40.04s, Dec −29° 00′ 28.1″.
 *
 * The epoch matters and is the reason `precess` exists below. Equatorial
 * coordinates are fixed to the earth's axis, and the axis moves — a full
 * circuit in about 26,000 years, so roughly 0.014° a year in right ascension.
 * Over the two and a half decades since J2000 that is about a third of a
 * degree: smaller than the region being pointed at, larger than the arcminute
 * the rest of this project works to, and free to correct for.
 */
export const CORE_J2000 = {
  rightAscension: (17 + 45 / 60 + 40.04 / 3600) * 15,
  declination: -(29 + 0 / 60 + 28.1 / 3600),
} as const;

/**
 * Where the core is above the horizon before it is worth calling "up".
 *
 * Zero would be dishonest in a different way from the sun's −0.833°. The sun's
 * offset exists because sunrise is a sharply defined event; the core has no
 * limb to clear and is extinguished by several magnitudes of atmosphere in the
 * last few degrees, so a "rise" at the geometric horizon describes a thing
 * nobody can photograph. Rise and set are still reported at 0° because that is
 * what the words mean and what a reader can check against another tool; the
 * *usable* windows take a minimum altitude, and default to ten degrees.
 */
export const CORE_RISE_ALTITUDE = 0;
export const CORE_USABLE_ALTITUDE = 10;

/**
 * How wide the bright part is, degrees.
 *
 * A number rather than the prose above, because anything asking whether the core
 * *fits in a frame* needs one, and two modules each picking their own would
 * disagree about the same photograph. It is a soft-edged brightness gradient
 * with no defined boundary, so this is a stated convention and not a
 * measurement: roughly the Sagittarius star cloud through to the Lagoon nebula,
 * which is the stretch people mean by "the core" and about what a 24mm frame is
 * composed around. Treat it as the scale of the thing, not its extent.
 */
export const CORE_SPAN_DEG = 15;

/**
 * J2000 equatorial coordinates, precessed to the epoch of date.
 *
 * Meeus's low-accuracy reduction (Astronomical Algorithms, ch. 21): good to a
 * few arcseconds over a century, which is four orders better than the size of
 * the thing being located. Rigorous enough that the epoch is no longer a
 * question anyone has to hold in their head.
 */
export function precess(
  rightAscension: number,
  declination: number,
  date: Date,
): { rightAscension: number; declination: number } {
  const T = (julianDay(date) - J2000) / JULIAN_CENTURY_DAYS;
  // Annual rates, in seconds and arcseconds of time and arc respectively.
  const m = 3.07496 + 0.00186 * T;
  const n = 20.0431 - 0.0085 * T;
  const years = T * 100;

  const deltaRaSeconds =
    m + (n / 15) * sin(rightAscension) * Math.tan(declination * RAD);
  const deltaDecArcsec = n * cos(rightAscension);

  return {
    rightAscension: norm360(rightAscension + (deltaRaSeconds * years * 15) / 3600),
    declination: declination + (deltaDecArcsec * years) / 3600,
  };
}

export interface CorePosition {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees above the horizon, geometric. */
  altitude: number;
  /** Lifted by refraction — where the eye would find it. */
  altitudeApparent: number;
  /** Precessed to the epoch of date, not J2000. */
  rightAscension: number;
  declination: number;
  /** Degrees; negative before transit, zero at it, positive after. */
  hourAngle: number;
}

/**
 * Where the core is, as seen from a place at an instant.
 *
 * No parallax term, unlike the moon: at 26,000 light years the earth's radius
 * subtends nothing measurable. The transform is otherwise the same one
 * `moonPosition` uses, and deliberately so — two objects placed by different
 * arithmetic would disagree about the sky in ways nobody could unpick.
 */
export function corePosition(latitude: number, longitude: number, date: Date): CorePosition {
  const { rightAscension, declination } = precess(
    CORE_J2000.rightAscension,
    CORE_J2000.declination,
    date,
  );

  const hourAngle = norm360(greenwichSiderealTime(date) + longitude - rightAscension);

  const x = cos(hourAngle) * cos(declination);
  const y = sin(hourAngle) * cos(declination);
  const z = sin(declination);
  const xh = x * sin(latitude) - z * cos(latitude);
  const zh = x * cos(latitude) + z * sin(latitude);

  const azimuth = norm360(Math.atan2(y, xh) * DEG + 180);
  const altitude = Math.atan2(zh, Math.hypot(xh, y)) * DEG;

  return {
    azimuth,
    altitude,
    altitudeApparent: altitude + refraction(altitude),
    rightAscension,
    declination,
    // Signed the way `sun.ts` reports it: negative on the way up.
    hourAngle: hourAngle > 180 ? hourAngle - 360 : hourAngle,
  };
}

export interface CoreSample extends CorePosition {
  date: Date;
}

/** The core's path across a window, sampled — the arc the dome draws. */
export function coreTrack(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  stepMinutes = 5,
): CoreSample[] {
  if (!(stepMinutes > 0)) throw new RangeError('stepMinutes must be greater than zero');
  if (to.getTime() < from.getTime()) throw new RangeError('`to` must not precede `from`');

  const step = stepMinutes * 60_000;
  const samples: CoreSample[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += step) {
    const at = new Date(t);
    samples.push({ ...corePosition(latitude, longitude, at), date: at });
  }
  return samples;
}

/* ── Intervals ─────────────────────────────────────────────────────────────
   Every question below is "when, inside this window, is some quantity above
   some threshold" — the sun below −18°, the moon under the horizon, the core
   above ten degrees. One sampler answers all of them, and the three answers can
   then simply be intersected. Doing it three different ways is how two of them
   end up disagreeing about a minute that matters. */

export interface Interval {
  from: Date;
  to: Date;
}

/**
 * The stretches of a window where `signed` is positive.
 *
 * Sampled and refined rather than solved, for the reason `moonTimes` gives: the
 * closed forms exist only for the sun, and only because its declination barely
 * moves. An interval that is open at either end of the window is reported
 * clipped to the window, which is the truthful thing — the caller asked about
 * tonight, not about the sky in general.
 */
export function intervalsWhere(
  from: Date,
  to: Date,
  stepMinutes: number,
  signed: (t: number) => number,
): Interval[] {
  if (!(stepMinutes > 0)) throw new RangeError('stepMinutes must be greater than zero');
  const step = stepMinutes * 60_000;
  const start = from.getTime();
  const end = to.getTime();

  const found: Interval[] = [];
  let openedAt: number | null = null;
  let previousT = start;
  let previous = signed(start);
  if (previous > 0) openedAt = start;

  for (let t = start + step; ; t += step) {
    // Always measure the exact end of the window, whatever the step leaves.
    const at = Math.min(t, end);
    const value = signed(at);
    if (previous <= 0 && value > 0) openedAt = bisect(previousT, at, signed);
    else if (previous > 0 && value <= 0 && openedAt !== null) {
      found.push({ from: new Date(openedAt), to: new Date(bisect(previousT, at, signed)) });
      openedAt = null;
    }
    previousT = at;
    previous = value;
    if (at >= end) break;
  }
  if (openedAt !== null) found.push({ from: new Date(openedAt), to: new Date(end) });
  return found;
}

/** Narrow a sign change down to the second. */
function bisect(lo: number, hi: number, f: (t: number) => number): number {
  let a = lo;
  let b = hi;
  const fa = f(a);
  for (let i = 0; i < 24 && b - a > 500; i++) {
    const mid = (a + b) / 2;
    if (Math.sign(f(mid)) === Math.sign(fa)) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}

/** Where two sets of intervals overlap. Both must be sorted and disjoint. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const from = Math.max(a[i].from.getTime(), b[j].from.getTime());
    const to = Math.min(a[i].to.getTime(), b[j].to.getTime());
    if (to > from) out.push({ from: new Date(from), to: new Date(to) });
    if (a[i].to.getTime() < b[j].to.getTime()) i++;
    else j++;
  }
  return out;
}

/* ── The night ─────────────────────────────────────────────────────────────*/

export interface CoreTimes {
  rise: Date | null;
  transit: Date | null;
  set: Date | null;
  /** Above the horizon for the whole window. */
  alwaysUp: boolean;
  /** Never comes up at all — everything north of about 61° N. */
  alwaysDown: boolean;
  peakAltitude: number;
  peakAt: Date;
}

/**
 * When the core crosses the horizon inside a window, and when it is highest.
 *
 * Transit is found as the peak of the sampled altitude rather than from the
 * hour angle, so it is still right when the peak falls outside the window or
 * the core never rises at all — cases the hour-angle form has to special-case
 * and usually gets wrong at the poles.
 */
export function coreTimes(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  stepMinutes = 5,
): CoreTimes {
  const above = (t: number) =>
    corePosition(latitude, longitude, new Date(t)).altitude - CORE_RISE_ALTITUDE;

  const up = intervalsWhere(from, to, stepMinutes, above);
  const step = stepMinutes * 60_000;

  let peakAltitude = -Infinity;
  let peakAt = from;
  for (let t = from.getTime(); t <= to.getTime(); t += step) {
    const altitude = corePosition(latitude, longitude, new Date(t)).altitude;
    if (altitude > peakAltitude) {
      peakAltitude = altitude;
      peakAt = new Date(t);
    }
  }

  const startedUp = above(from.getTime()) > 0;
  const endedUp = above(to.getTime()) > 0;
  const rise = up.find((w) => w.from.getTime() > from.getTime())?.from ?? null;
  const set = [...up].reverse().find((w) => w.to.getTime() < to.getTime())?.to ?? null;

  return {
    rise,
    set,
    transit: peakAltitude > CORE_RISE_ALTITUDE ? peakAt : null,
    alwaysUp: up.length === 1 && startedUp && endedUp,
    alwaysDown: up.length === 0,
    peakAltitude,
    peakAt,
  };
}

export interface CoreNight {
  core: CoreTimes;
  /** Sun below −18°: the sky itself is dark. */
  darkness: Interval[];
  /** Darkness with the moon also below the horizon. */
  moonFree: Interval[];
  /** Moon-free darkness with the core above `minAltitude`. The answer. */
  visible: Interval[];
  /** Highest the core gets while it is visible, and when. Null if never. */
  best: { at: Date; altitude: number } | null;
  /**
   * The atlas zone this night was checked against, or null when the caller
   * had no answer (the raster failed to load, or nobody asked) — in which
   * case light pollution plays no part in `visible` or `refusal` at all,
   * exactly as if issue #46 had never landed.
   */
  lightPollutionZone: number | null;
  /** Why there is nothing, when there is nothing. Empty when `visible` is not. */
  refusal: string;
}

/**
 * The whole question, for one window — normally the night either side of a date.
 *
 * The conditions are computed separately and intersected, so a caller can show
 * *which* of them failed. That distinction is the useful part: "the core never
 * rises here" is a reason to go somewhere else, "the moon is up all night" is a
 * reason to come back in a fortnight, and they are the same empty list if you
 * only report the intersection.
 *
 * `lightPollutionZone` is not a window like the other three — a place's sky
 * brightness does not turn on and off in one night — so it does not get its
 * own `Interval[]`. It is a single yes/no gate on the whole answer: below
 * `CORE_DARK_ENOUGH_MAX_ZONE`, moon-free darkness with the core up is real;
 * at or above it, `visible` is empty regardless of what the moon is doing,
 * because "the moon is down" was never the thing standing between the core
 * and the sensor.
 */
export function coreNight(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  minAltitude = CORE_USABLE_ALTITUDE,
  stepMinutes = 5,
  lightPollutionZone: number | null = null,
): CoreNight {
  const core = coreTimes(latitude, longitude, from, to, stepMinutes);

  const darkness = intervalsWhere(
    from,
    to,
    stepMinutes,
    (t) => SUN_ALTITUDE.astronomical - sunPosition(latitude, longitude, new Date(t)).altitude,
  );
  const moonDown = intervalsWhere(
    from,
    to,
    stepMinutes,
    (t) => MOONRISE_ALTITUDE - moonPosition(latitude, longitude, new Date(t)).altitude,
  );
  const coreUp = intervalsWhere(
    from,
    to,
    stepMinutes,
    (t) => corePosition(latitude, longitude, new Date(t)).altitude - minAltitude,
  );

  const moonFree = intersect(darkness, moonDown);
  const darkEnough = lightPollutionZone === null || lightPollutionDarkEnough(lightPollutionZone);
  const visible = darkEnough ? intersect(moonFree, coreUp) : [];

  let best: CoreNight['best'] = null;
  const step = stepMinutes * 60_000;
  for (const window of visible) {
    for (let t = window.from.getTime(); t <= window.to.getTime(); t += step) {
      const altitude = corePosition(latitude, longitude, new Date(t)).altitude;
      if (!best || altitude > best.altitude) best = { at: new Date(t), altitude };
    }
  }

  return {
    core,
    darkness,
    moonFree,
    visible,
    best,
    lightPollutionZone,
    refusal: refusalFor({ core, darkness, moonFree, coreUp, visible, minAltitude, lightPollutionZone, darkEnough }),
  };
}

/**
 * The first condition that failed, said plainly.
 *
 * Ordered from the most permanent to the most temporary, because that is the
 * order in which the answer changes what someone does: a latitude cannot be
 * waited out, a season can, the moon can be waited out for a fortnight, and a
 * clash of hours for a day.
 */
function refusalFor(state: {
  core: CoreTimes;
  darkness: Interval[];
  moonFree: Interval[];
  coreUp: Interval[];
  visible: Interval[];
  minAltitude: number;
  lightPollutionZone: number | null;
  darkEnough: boolean;
}): string {
  if (state.visible.length) return '';
  // Checked ahead of the latitude/rise conditions below: like them, this is
  // a fact about the place rather than about tonight, and unlike them it
  // makes every other condition moot at once — there is no point telling
  // someone the core clears 10° and the moon sets early when the sky itself
  // will still swallow it.
  if (state.lightPollutionZone !== null && !state.darkEnough) {
    return `The sky here is too bright for the core regardless of the moon (zone ${state.lightPollutionZone} of ${ZONE_COUNT - 1}).`;
  }
  if (state.core.alwaysDown) return 'The core never rises here.';
  if (!state.coreUp.length) {
    return `The core does not clear ${state.minAltitude}° here tonight — it peaks at ${state.core.peakAltitude.toFixed(0)}°.`;
  }
  if (!state.darkness.length) {
    return 'It never gets astronomically dark tonight — the sun stays above −18°.';
  }
  if (!state.moonFree.length) return 'The moon is up for the whole of the dark window.';
  return 'The core is up, and the sky is dark, but not at the same time tonight.';
}
