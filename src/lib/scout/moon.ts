/**
 * The moon: where it is, what shape it is, and when it rises.
 *
 * The sister of `sun.ts` and built to the same rules — pure functions of
 * (latitude, longitude, instant), no map, no network, no clock of its own. A
 * moonlit frame is planned exactly the way a golden-hour one is: you need the
 * bearing to put it behind something, the altitude to know whether it clears the
 * roofline, and the phase to know whether there is enough of it to expose for.
 *
 * Algorithm: the classic truncated lunar theory — orbital elements integrated
 * from the epoch, Kepler solved, then the dozen largest periodic perturbations
 * applied (evection, variation, the yearly and parallactic equations, and the
 * principal terms in latitude and distance). That is the same short series
 * Schlyter publishes and that most planetarium software uses when it does not
 * need arcsecond work: about 1–2 arcminutes in longitude and well under one in
 * latitude. The moon's own disc is 31 arcminutes across, so the error is a
 * twentieth of the thing you are pointing at.
 *
 * Two places this deliberately does more than the minimum, because both are
 * larger than that error and both would be felt in the field:
 *
 *   - **Parallax.** The moon is close enough that where you stand on the earth
 *     moves it by up to a degree — two full moon-widths, and always downward.
 *     Geocentric altitude is what the textbook formula gives; the topocentric
 *     one is what you actually see, and it is what `altitude` reports.
 *   - **Sidereal time** comes from the standard IAU expression rather than from
 *     the sun's mean longitude, so it does not inherit any of the sun model's
 *     approximation.
 */

import { refraction, solarState } from './sun';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
/** Schlyter's epoch: 2000 January 0.0 UT, one day before J2000's noon. */
const ELEMENT_EPOCH_JD = 2451543.5;

/** Equatorial radius, km — the one lunar parallax is defined against. */
const EARTH_EQUATORIAL_RADIUS_KM = 6378.137;

/**
 * Altitude of the moon's centre when its upper limb touches the horizon:
 * refraction lifts the image about 0.567°, and the disc's own radius is a
 * further 0.259°. The same reasoning as `sun.ts`, and the same order of
 * correction — leaving it out puts moonrise minutes early.
 *
 * Applied to the *topocentric* altitude, so parallax is already accounted for
 * and must not be subtracted again here.
 */
export const MOONRISE_ALTITUDE = -0.833;

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);

const julianDay = (date: Date): number => date.getTime() / DAY_MS + UNIX_EPOCH_JD;

/** Days since the element epoch — the argument every orbital element takes. */
const dayNumber = (date: Date): number => julianDay(date) - ELEMENT_EPOCH_JD;

/* ── Geocentric position ───────────────────────────────────────────────────── */

export interface MoonEcliptic {
  /** Apparent geocentric ecliptic longitude, degrees. */
  longitude: number;
  /** Ecliptic latitude, degrees. Never outside about ±5.3°. */
  latitude: number;
  /** Distance in earth radii, roughly 56–64. */
  distanceER: number;
}

/**
 * The moon in ecliptic coordinates.
 *
 * The unperturbed ellipse first, then the corrections. Those corrections are not
 * a polish: the evection term alone is 1.27°, some forty times the moon's own
 * radius, and a model without it would put the moon in the wrong part of the sky
 * for most of the month.
 */
export function moonEcliptic(date: Date): MoonEcliptic {
  const d = dayNumber(date);

  // Sun, for the arguments the perturbations are expressed in.
  const wSun = 282.9404 + 4.70935e-5 * d;
  const mSun = norm360(356.047 + 0.9856002585 * d);

  // Moon's own elements.
  const node = 125.1228 - 0.0529538083 * d;
  const inclination = 5.1454;
  const perigee = 318.0634 + 0.1643573223 * d;
  const semiMajor = 60.2666;
  const eccentricity = 0.0549;
  const meanAnomaly = norm360(115.3654 + 13.0649929509 * d);

  // Kepler's equation. The moon's eccentricity is small, so the first guess is
  // already good to an arcminute and one Newton step settles it.
  let E = meanAnomaly + DEG * eccentricity * sin(meanAnomaly) * (1 + eccentricity * cos(meanAnomaly));
  for (let i = 0; i < 4; i++) {
    const delta = (E - DEG * eccentricity * sin(E) - meanAnomaly) / (1 - eccentricity * cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-9) break;
  }

  const xv = semiMajor * (cos(E) - eccentricity);
  const yv = semiMajor * (Math.sqrt(1 - eccentricity * eccentricity) * sin(E));
  const distance = Math.hypot(xv, yv);
  const trueAnomaly = norm360(Math.atan2(yv, xv) * DEG);

  // Into the ecliptic frame, through the node and the inclination.
  const u = trueAnomaly + perigee;
  const xe = distance * (cos(node) * cos(u) - sin(node) * sin(u) * cos(inclination));
  const ye = distance * (sin(node) * cos(u) + cos(node) * sin(u) * cos(inclination));
  const ze = distance * (sin(u) * sin(inclination));

  let longitude = norm360(Math.atan2(ye, xe) * DEG);
  let latitude = Math.atan2(ze, Math.hypot(xe, ye)) * DEG;
  let radius = Math.hypot(xe, ye, ze);

  // The arguments the perturbation series is written in.
  const moonMean = norm360(node + perigee + meanAnomaly);
  const sunMean = norm360(mSun + wSun);
  /** Mean elongation — how far the moon has swung from the sun. */
  const D = norm360(moonMean - sunMean);
  /** Argument of latitude — how far it is from the ascending node. */
  const F = norm360(moonMean - node);

  longitude +=
    -1.274 * sin(meanAnomaly - 2 * D) + // evection
    0.658 * sin(2 * D) + // variation
    -0.186 * sin(mSun) + // yearly equation
    -0.059 * sin(2 * meanAnomaly - 2 * D) +
    -0.057 * sin(meanAnomaly - 2 * D + mSun) +
    0.053 * sin(meanAnomaly + 2 * D) +
    0.046 * sin(2 * D - mSun) +
    0.041 * sin(meanAnomaly - mSun) +
    -0.035 * sin(D) + // parallactic equation
    -0.031 * sin(meanAnomaly + mSun) +
    -0.015 * sin(2 * F - 2 * D) +
    0.011 * sin(meanAnomaly - 4 * D);

  latitude +=
    -0.173 * sin(F - 2 * D) +
    -0.055 * sin(meanAnomaly - F - 2 * D) +
    -0.046 * sin(meanAnomaly + F - 2 * D) +
    0.033 * sin(F + 2 * D) +
    0.017 * sin(2 * meanAnomaly + F);

  radius += -0.58 * cos(meanAnomaly - 2 * D) - 0.46 * cos(2 * D);

  return { longitude: norm360(longitude), latitude, distanceER: radius };
}

/**
 * Greenwich mean sidereal time, degrees. IAU 1982 expression (Meeus 12.4).
 *
 * Which star is overhead at Greenwich right now — the thing that turns a
 * celestial coordinate into a direction to look. Taken from the standard series
 * rather than from the sun's mean longitude so it carries no error from the
 * solar model.
 */
export function greenwichSiderealTime(date: Date): number {
  const jd = julianDay(date);
  const T = (jd - J2000) / 36525;
  return norm360(
    280.46061837 +
      360.98564736629 * (jd - J2000) +
      0.000387933 * T * T -
      (T * T * T) / 38_710_000,
  );
}

/** Obliquity of the ecliptic at the epoch of date, degrees. */
const obliquity = (d: number) => 23.4393 - 3.563e-7 * d;

export interface MoonPosition {
  /** Degrees clockwise from true north. Topocentric — what you would point at. */
  azimuth: number;
  /** Degrees above the horizon, as seen from the ground. Parallax applied. */
  altitude: number;
  /** Lifted further by atmospheric refraction — what the eye actually sees. */
  altitudeApparent: number;
  /** As seen from the centre of the earth, before parallax. Kept for comparison. */
  altitudeGeocentric: number;
  /** How much parallax moved it, degrees. Up to about 1°, always downward. */
  parallax: number;
  distanceKm: number;
  rightAscension: number;
  declination: number;
  eclipticLongitude: number;
  eclipticLatitude: number;
  /** Angular radius of the disc, degrees — about 0.25°, and it varies by a tenth. */
  angularRadius: number;
}

export function moonPosition(latitude: number, longitude: number, date: Date): MoonPosition {
  const lat = clamp(latitude, -89.9999, 89.9999);
  const d = dayNumber(date);
  const ecliptic = moonEcliptic(date);
  const ecl = obliquity(d);

  // Ecliptic → equatorial.
  const xe = ecliptic.distanceER * cos(ecliptic.latitude) * cos(ecliptic.longitude);
  const ye = ecliptic.distanceER * cos(ecliptic.latitude) * sin(ecliptic.longitude);
  const ze = ecliptic.distanceER * sin(ecliptic.latitude);

  const xq = xe;
  const yq = ye * cos(ecl) - ze * sin(ecl);
  const zq = ye * sin(ecl) + ze * cos(ecl);

  const rightAscension = norm360(Math.atan2(yq, xq) * DEG);
  const declination = Math.atan2(zq, Math.hypot(xq, yq)) * DEG;

  const hourAngle = norm360(greenwichSiderealTime(date) + longitude - rightAscension);

  // Equatorial → horizon.
  const x = cos(hourAngle) * cos(declination);
  const y = sin(hourAngle) * cos(declination);
  const z = sin(declination);
  const xh = x * sin(lat) - z * cos(lat);
  const yh = y;
  const zh = x * cos(lat) + z * sin(lat);

  const azimuth = norm360(Math.atan2(yh, xh) * DEG + 180);
  const altitudeGeocentric = Math.atan2(zh, Math.hypot(xh, yh)) * DEG;

  // Parallax: the moon is close, so an observer on the surface sees it lower
  // than the earth's centre does — by the full horizontal parallax at the
  // horizon, and by nothing at all at the zenith.
  const horizontalParallax = Math.asin(1 / ecliptic.distanceER) * DEG;
  const parallax = horizontalParallax * cos(altitudeGeocentric);
  const altitude = altitudeGeocentric - parallax;

  return {
    azimuth,
    altitude,
    altitudeApparent: altitude + refraction(altitude),
    altitudeGeocentric,
    parallax,
    distanceKm: ecliptic.distanceER * EARTH_EQUATORIAL_RADIUS_KM,
    rightAscension,
    declination,
    eclipticLongitude: ecliptic.longitude,
    eclipticLatitude: ecliptic.latitude,
    // 1737.4 km radius at whatever distance it happens to be.
    angularRadius: Math.asin(1737.4 / (ecliptic.distanceER * EARTH_EQUATORIAL_RADIUS_KM)) * DEG,
  };
}

/* ── Phase ─────────────────────────────────────────────────────────────────── */

export type MoonPhaseName =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

export const MOON_PHASE_LABEL: Record<MoonPhaseName, string> = {
  new: 'New moon',
  'waxing-crescent': 'Waxing crescent',
  'first-quarter': 'First quarter',
  'waxing-gibbous': 'Waxing gibbous',
  full: 'Full moon',
  'waning-gibbous': 'Waning gibbous',
  'last-quarter': 'Last quarter',
  'waning-crescent': 'Waning crescent',
};

export interface MoonIllumination {
  /**
   * How far round the cycle it is, degrees: 0 new, 90 first quarter, 180 full,
   * 270 last quarter. This is the moon's elongation *measured in longitude*, so
   * unlike the illuminated fraction it distinguishes waxing from waning.
   */
  age: number;
  /** Sun–earth–moon angle, degrees: 0 at full, 180 at new. */
  phaseAngle: number;
  /** Fraction of the disc that is lit, 0–1. */
  fraction: number;
  waxing: boolean;
  name: MoonPhaseName;
  /** Days since the last new moon, on the mean synodic month. */
  ageDays: number;
}

/** Mean length of a lunation, days. */
export const SYNODIC_MONTH_DAYS = 29.530588853;

/**
 * How much of the moon is lit, and which way it is going.
 *
 * The illuminated fraction is symmetric — a five-day-old crescent and a
 * twenty-four-day-old one are the same sliver — so the *name* is taken from the
 * elongation in longitude, which runs monotonically round the month, rather than
 * from the fraction. Reporting "waxing crescent" for a waning one would be a
 * plausible-looking answer that sends you out on the wrong night.
 */
export function moonIllumination(date: Date): MoonIllumination {
  const moon = moonEcliptic(date);
  const T = (julianDay(date) - J2000) / 36525;
  const sunLongitude = norm360(solarState(T).apparentLongitude);

  const age = norm360(moon.longitude - sunLongitude);
  // True elongation on the sphere, which the ecliptic latitude tilts slightly
  // away from the plain longitude difference.
  const elongation = Math.acos(clamp(cos(moon.latitude) * cos(age), -1, 1)) * DEG;
  const phaseAngle = 180 - elongation;
  const fraction = (1 + cos(phaseAngle)) / 2;

  return {
    age,
    phaseAngle,
    fraction,
    waxing: age < 180,
    name: phaseName(age),
    ageDays: (age / 360) * SYNODIC_MONTH_DAYS,
  };
}

/**
 * The named phase for a position in the cycle.
 *
 * The four exact phases are instants, and nobody means an instant when they say
 * "full moon" — so each gets a window of ±6.5°, about half a day either side,
 * which is roughly how long the disc looks full to the eye.
 */
export function phaseName(age: number): MoonPhaseName {
  const a = norm360(age);
  if (a < 6.5 || a >= 353.5) return 'new';
  if (a < 83.5) return 'waxing-crescent';
  if (a < 96.5) return 'first-quarter';
  if (a < 173.5) return 'waxing-gibbous';
  if (a < 186.5) return 'full';
  if (a < 263.5) return 'waning-gibbous';
  if (a < 276.5) return 'last-quarter';
  return 'waning-crescent';
}

/* ── Rise and set ──────────────────────────────────────────────────────────── */

export interface MoonSample extends MoonPosition {
  date: Date;
}

export interface MoonTrackOptions {
  stepMinutes?: number;
}

/** The moon's path across a window, sampled — the arc the map draws. */
export function moonTrack(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  options: MoonTrackOptions = {},
): MoonSample[] {
  const stepMinutes = options.stepMinutes ?? 5;
  if (!(stepMinutes > 0)) throw new RangeError('stepMinutes must be greater than zero');
  if (to.getTime() < from.getTime()) throw new RangeError('`to` must not precede `from`');

  const step = stepMinutes * 60_000;
  const samples: MoonSample[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += step) {
    const at = new Date(t);
    samples.push({ ...moonPosition(latitude, longitude, at), date: at });
  }
  return samples;
}

export interface MoonTimes {
  rise: Date | null;
  set: Date | null;
  /** True when the moon is above the horizon for the whole window. */
  alwaysUp: boolean;
  /** True when it never comes up at all. */
  alwaysDown: boolean;
  /** Highest it gets in the window, degrees, and when. */
  peakAltitude: number;
  peakAt: Date;
}

/**
 * When the moon crosses the horizon inside a window.
 *
 * Found by sampling and refining rather than solved in closed form. The moon's
 * declination changes by several degrees a day — twenty-odd times faster than
 * the sun's — so the tidy "hour angle at solar noon" shortcut that works in
 * `sun.ts` does not transfer, and every published closed form for moonrise is
 * itself an iteration wearing a hat. Sampling is honest about that and has no
 * special cases at the poles: a window with no crossing simply has none.
 *
 * The window is normally the solar day the rest of the UI is built around, so
 * "moonrise" means the one belonging to the day on the slider. That is why both
 * can be null while the moon is plainly up — it rose yesterday.
 */
export function moonTimes(
  latitude: number,
  longitude: number,
  from: Date,
  to: Date,
  stepMinutes = 10,
): MoonTimes {
  const altitudeAt = (t: number) =>
    moonPosition(latitude, longitude, new Date(t)).altitude - MOONRISE_ALTITUDE;

  const step = stepMinutes * 60_000;
  const start = from.getTime();
  const end = to.getTime();

  let rise: Date | null = null;
  let set: Date | null = null;
  let everUp = false;
  let everDown = false;
  let peakAltitude = -Infinity;
  let peakAt = from;

  let previousT = start;
  let previous = altitudeAt(start);
  if (previous > 0) everUp = true;
  else everDown = true;

  const track = (t: number, value: number) => {
    const altitude = value + MOONRISE_ALTITUDE;
    if (altitude > peakAltitude) {
      peakAltitude = altitude;
      peakAt = new Date(t);
    }
  };
  track(start, previous);

  for (let t = start + step; t <= end; t += step) {
    const value = altitudeAt(t);
    track(t, value);
    if (value > 0) everUp = true;
    else everDown = true;

    if (previous <= 0 && value > 0 && !rise) {
      rise = new Date(bisect(previousT, t, altitudeAt));
    } else if (previous > 0 && value <= 0 && !set) {
      set = new Date(bisect(previousT, t, altitudeAt));
    }
    previousT = t;
    previous = value;
  }

  return {
    rise,
    set,
    alwaysUp: everUp && !everDown,
    alwaysDown: everDown && !everUp,
    peakAltitude,
    peakAt,
  };
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

/* ── Presentation ──────────────────────────────────────────────────────────── */

/**
 * How much light there is to work with, as a sentence.
 *
 * A full moon at 40° is a usable key light — landscapes at ISO 3200 and a few
 * seconds. The same moon at 3° is behind every tree on the horizon, and a
 * crescent is a subject rather than a source. The number that decides it is
 * illuminated fraction times how high it is, so that is what this reads.
 */
export function moonlightNote(altitude: number, fraction: number): string {
  if (altitude <= MOONRISE_ALTITUDE) return 'below the horizon';
  if (fraction < 0.15) return 'a sliver — a subject, not a light';
  if (altitude < 10) return 'low — behind anything on the skyline';
  if (fraction > 0.85) return 'bright enough to light a landscape';
  if (fraction > 0.5) return 'usable fill on a long exposure';
  return 'faint — expect to expose for the sky';
}
