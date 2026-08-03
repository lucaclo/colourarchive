/**
 * Solar position and event times — the foundation every other part of Scout
 * reads from. Pure functions of (latitude, longitude, instant): no map, no
 * network, no clock of its own, no timezone database. That is deliberate. It
 * makes the whole thing testable against published almanac values, and it means
 * the sun half of Scout keeps working with the Mac off and the Wi-Fi gone.
 *
 * Algorithm: Meeus, *Astronomical Algorithms* (2nd ed.), in the low-precision
 * form NOAA publishes with its solar calculator. Good to well under an arcminute
 * for any date within a few centuries of now — a couple of orders of magnitude
 * finer than anyone can plant a tripod.
 *
 * Everything in and out is a UTC instant. Formatting into a local wall clock is
 * the caller's problem; there is no timezone data in here and there should not
 * be. The UI ships today-only, but nothing below knows that — every function
 * takes an arbitrary date, so a date picker is a UI change later, not a rewrite.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86_400_000;

/** Julian Day of 2000-01-01T12:00:00Z, the standard epoch. */
const J2000 = 2451545.0;
/** Julian Day of the Unix epoch, 1970-01-01T00:00:00Z. */
const UNIX_EPOCH_JD = 2440587.5;

/** Latitude is clamped just short of the poles: cos(±90°) is 0 and every
 *  azimuth formula divides by it. A photographer standing exactly on the pole
 *  is not the case worth crashing for. */
const MAX_LAT = 89.9999;

const norm360 = (d: number) => ((d % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const julianDay = (date: Date): number => date.getTime() / DAY_MS + UNIX_EPOCH_JD;
export const dateFromJulianDay = (jd: number): Date => new Date((jd - UNIX_EPOCH_JD) * DAY_MS);
const julianCentury = (jd: number) => (jd - J2000) / 36525;

/* ── Sun altitude thresholds ───────────────────────────────────────────────
   The twilight figures are the standard definitions. The golden and blue
   bounds are the photographer's convention (PhotoPills and TPE use the same
   ones): golden hour straddles the horizon from -4° to +6°, blue hour sits in
   the lower half of civil twilight from -6° to -4°.

   `sunrise` is -0.833° rather than 0° because "sunrise" means the *upper limb*
   appearing, not the centre: about 0.267° of solar radius plus about 0.567° of
   atmospheric refraction lifting the image. Leaving this out puts sunrise
   several minutes late — exactly when the light is changing fastest. */
export const SUN_ALTITUDE = {
  sunrise: -0.833,
  goldenUpper: 6,
  goldenLower: -4,
  blueUpper: -4,
  blueLower: -6,
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

/* ── Core solar state ──────────────────────────────────────────────────────
   Everything that depends only on time, not on where you are standing. */

export interface SolarState {
  /** Degrees north of the celestial equator, ±23.44° across the year. */
  declination: number;
  /** Degrees, 0–360. */
  rightAscension: number;
  /** Minutes that apparent solar time runs ahead of mean solar time, ±17. */
  equationOfTime: number;
  /** Apparent ecliptic longitude, degrees. */
  apparentLongitude: number;
  /** Obliquity of the ecliptic, degrees. */
  obliquity: number;
  /** Earth–Sun distance in astronomical units, ~0.983–1.017. */
  distanceAU: number;
}

export function solarState(T: number): SolarState {
  const meanLongitude = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const meanAnomaly = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const eccentricity = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const M = meanAnomaly * RAD;
  const centre =
    Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M) * 0.000289;

  const trueLongitude = meanLongitude + centre;
  const trueAnomaly = meanAnomaly + centre;
  const distanceAU =
    (1.000001018 * (1 - eccentricity * eccentricity)) /
    (1 + eccentricity * Math.cos(trueAnomaly * RAD));

  // Nutation and aberration, to the one term that matters at this precision.
  const omega = (125.04 - 1934.136 * T) * RAD;
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega);

  const seconds = 21.448 - T * (46.815 + T * (0.00059 - T * 0.001813));
  const meanObliquity = 23 + (26 + seconds / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega);

  const lambda = apparentLongitude * RAD;
  const epsilon = obliquity * RAD;

  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda)) * DEG;
  const rightAscension = norm360(
    Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)) * DEG,
  );

  // Equation of time, Meeus 28.3. This is why solar noon is not 12:00 and why
  // sundials disagree with clocks by up to a quarter of an hour.
  const y = Math.tan(epsilon / 2) ** 2;
  const L = meanLongitude * RAD;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * L) -
      2 * eccentricity * Math.sin(M) +
      4 * eccentricity * y * Math.sin(M) * Math.cos(2 * L) -
      0.5 * y * y * Math.sin(4 * L) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * M));

  return {
    declination,
    rightAscension,
    equationOfTime,
    apparentLongitude,
    obliquity,
    distanceAU,
  };
}

/* ── Atmospheric refraction ────────────────────────────────────────────────
   The atmosphere bends light down, so the sun *looks* higher than it is —
   by about half a degree at the horizon, which is more than its own width.
   Reported separately from the geometric altitude rather than folded into it:
   shadow geometry wants the true position, a person looking at the sky wants
   the apparent one, and quietly conflating them is how you end up several
   minutes wrong at exactly the hour that matters. */
export function refraction(geometricAltitude: number): number {
  if (geometricAltitude > 85) return 0;
  const t = Math.tan(geometricAltitude * RAD);
  let arcseconds: number;
  if (geometricAltitude > 5) {
    arcseconds = 58.1 / t - 0.07 / t ** 3 + 0.000086 / t ** 5;
  } else if (geometricAltitude > -0.575) {
    const e = geometricAltitude;
    arcseconds = 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  } else {
    arcseconds = -20.772 / t;
  }
  return arcseconds / 3600;
}

/* ── Position ──────────────────────────────────────────────────────────────── */

export interface SunPosition {
  /** Degrees clockwise from true north: 90 = due east, 180 = due south. */
  azimuth: number;
  /** Degrees above the horizon, geometric centre of the sun. Negative at night. */
  altitude: number;
  /** Altitude as the eye sees it, lifted by atmospheric refraction. */
  altitudeApparent: number;
  declination: number;
  /** Degrees; negative before solar noon, zero at it, positive after. */
  hourAngle: number;
  equationOfTime: number;
  distanceAU: number;
}

export function sunPosition(latitude: number, longitude: number, date: Date): SunPosition {
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT);
  const jd = julianDay(date);
  const state = solarState(julianCentury(jd));

  // True solar time: clock time, corrected for where you are inside your
  // timezone and for the earth's uneven progress around its orbit.
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / 60_000;
  const trueSolarTime = ((utcMinutes + state.equationOfTime + 4 * longitude) % 1440 + 1440) % 1440;
  const hourAngle = trueSolarTime / 4 - 180;

  const latR = lat * RAD;
  const decR = state.declination * RAD;
  const haR = hourAngle * RAD;

  const cosZenith = clamp(
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith);
  const altitude = 90 - zenith * DEG;

  let azimuth: number;
  const denominator = Math.cos(latR) * Math.sin(zenith);
  if (Math.abs(denominator) < 1e-9) {
    // Sun straight overhead or straight underfoot: azimuth is undefined. Face
    // the equator, which is what every other implementation settles on.
    azimuth = lat > 0 ? 180 : 0;
  } else {
    const cosAz = clamp((Math.sin(latR) * cosZenith - Math.sin(decR)) / denominator, -1, 1);
    azimuth = 180 - Math.acos(cosAz) * DEG;
    if (hourAngle > 0) azimuth = -azimuth;
    azimuth = norm360(azimuth);
  }

  return {
    azimuth,
    altitude,
    altitudeApparent: altitude + refraction(altitude),
    declination: state.declination,
    hourAngle,
    equationOfTime: state.equationOfTime,
    distanceAU: state.distanceAU,
  };
}

/* ── Shadow geometry ───────────────────────────────────────────────────────
   Two one-line consequences of the sun's position, kept here because they are
   pure sun and nothing to do with a map. Parts 4a and 7 both build on them. */

/** The compass direction a shadow points: directly away from the sun. */
export const shadowBearing = (azimuth: number): number => norm360(azimuth + 180);

/**
 * Shadow length as a multiple of the object's height — cot(altitude). A 10m
 * building at 45° casts 10m; at 5° it casts 114m. Infinite at or below the
 * horizon, which is the honest answer: there is no sun to cast one.
 */
export const shadowLengthRatio = (altitude: number): number =>
  altitude <= 0 ? Infinity : 1 / Math.tan(altitude * RAD);

/* ── Event times ───────────────────────────────────────────────────────────── */

/**
 * Julian Day of solar noon for the solar day containing `date` at `longitude`.
 *
 * Anchoring on solar noon rather than on a calendar day sidesteps the whole
 * timezone question: at longitude 150°E the local day starts 10 hours before
 * the UTC one, and asking "what does the sun do today" has no answer until you
 * say whose today. The solar day is the unambiguous one, and it is the one a
 * photographer means.
 */
function meanSolarNoonJulianDay(longitude: number, date: Date): number {
  const daysSinceEpoch = julianDay(date) - J2000;
  // Whole days from J2000, shifted west by longitude.
  return J2000 + Math.round(daysSinceEpoch + longitude / 360) - longitude / 360;
}

export function solarNoonJulianDay(longitude: number, date: Date): number {
  const meanNoon = meanSolarNoonJulianDay(longitude, date);
  let noon = meanNoon;
  // Correct for the equation of time, twice — the correction moves the instant,
  // which slightly changes the correction.
  for (let i = 0; i < 2; i++) {
    noon = meanNoon - solarState(julianCentury(noon)).equationOfTime / 1440;
  }
  return noon;
}

type HourAngleResult =
  | { kind: 'ok'; degrees: number }
  /** The sun never climbs this high on this day. */
  | { kind: 'always-below' }
  /** The sun never sinks this low on this day. */
  | { kind: 'always-above' };

function hourAngleAtAltitude(
  latitude: number,
  declination: number,
  altitude: number,
): HourAngleResult {
  const lat = latitude * RAD;
  const dec = declination * RAD;
  const cosH =
    (Math.sin(altitude * RAD) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
  if (cosH > 1) return { kind: 'always-below' };
  if (cosH < -1) return { kind: 'always-above' };
  return { kind: 'ok', degrees: Math.acos(cosH) * DEG };
}

type CrossingResult =
  | { kind: 'ok'; rise: Date; set: Date }
  | { kind: 'always-below' }
  | { kind: 'always-above' };

/**
 * When the sun crosses a given altitude, rising and setting.
 *
 * Solved as a fixed point rather than as an offset from solar noon, because
 * *both* quantities involved drift across the day:
 *
 *   event = meanSolarNoon - equationOfTime(event)/1440 ∓ hourAngle(event)/360
 *
 * Anchoring on true solar noon and subtracting the hour angle — the obvious
 * way — silently assumes the equation of time is the same at sunrise as at
 * noon. It is not. Near the December solstice it drifts about half a minute a
 * day, and sunrise can be seven hours from noon, which puts sunrise a good ten
 * seconds out. Small, but the whole point of this file is that the numbers are
 * trustworthy, and it is the same size as the refraction correction we bothered
 * to make.
 *
 * Three passes converges to well under a second.
 */
function crossingsAt(latitude: number, meanNoonJD: number, altitude: number): CrossingResult {
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT);
  const seed = solarState(julianCentury(meanNoonJD));
  const first = hourAngleAtAltitude(lat, seed.declination, altitude);
  if (first.kind !== 'ok') return { kind: first.kind };

  const trueNoon = meanNoonJD - seed.equationOfTime / 1440;
  let riseJD = trueNoon - first.degrees / 360;
  let setJD = trueNoon + first.degrees / 360;

  for (let i = 0; i < 3; i++) {
    const atRise = solarState(julianCentury(riseJD));
    const atSet = solarState(julianCentury(setJD));
    const haRise = hourAngleAtAltitude(lat, atRise.declination, altitude);
    const haSet = hourAngleAtAltitude(lat, atSet.declination, altitude);
    if (haRise.kind !== 'ok' || haSet.kind !== 'ok') break;
    riseJD = meanNoonJD - atRise.equationOfTime / 1440 - haRise.degrees / 360;
    setJD = meanNoonJD - atSet.equationOfTime / 1440 + haSet.degrees / 360;
  }

  return { kind: 'ok', rise: dateFromJulianDay(riseJD), set: dateFromJulianDay(setJD) };
}

export interface LightWindow {
  start: Date;
  end: Date;
}

export type PolarState = 'none' | 'midnight-sun' | 'polar-night';

export interface SunTimes {
  /** Bounds of the solar day these times belong to — solar midnight to solar midnight. */
  dayStart: Date;
  dayEnd: Date;
  solarNoon: Date;
  solarMidnight: Date;

  sunrise: Date | null;
  sunset: Date | null;

  /**
   * Golden and blue hour as *arrays*, because at high latitudes they are not
   * always a tidy pair. Under the midnight sun the golden band is crossed
   * around midnight, not around sunrise; in deep winter the sun can spend the
   * whole short day inside it and never leave. Zero, one or two windows —
   * anything else would mean lying about one of those cases.
   */
  goldenHour: LightWindow[];
  blueHour: LightWindow[];

  civilDawn: Date | null;
  civilDusk: Date | null;
  nauticalDawn: Date | null;
  nauticalDusk: Date | null;
  astronomicalDawn: Date | null;
  astronomicalDusk: Date | null;

  /** Sunrise to sunset. Null when the sun does not rise or does not set. */
  dayLengthMinutes: number | null;
  polar: PolarState;
  /** Highest and lowest the sun gets on this day, degrees. */
  maxAltitude: number;
  minAltitude: number;
}

/**
 * The windows in which the sun sits inside an altitude band, across one solar
 * day. Handles every case the poles can produce, which is the whole reason this
 * is not two subtractions.
 */
function bandWindows(
  latitude: number,
  meanNoonJD: number,
  noonJD: number,
  lower: number,
  upper: number,
): LightWindow[] {
  const dayStart = dateFromJulianDay(noonJD - 0.5);
  const dayEnd = dateFromJulianDay(noonJD + 0.5);
  const low = crossingsAt(latitude, meanNoonJD, lower);
  const high = crossingsAt(latitude, meanNoonJD, upper);

  // The sun never even reaches the bottom of the band.
  if (low.kind === 'always-below') return [];

  if (low.kind === 'ok') {
    // Peaks inside the band: one window, straddling noon.
    if (high.kind === 'always-below') return [{ start: low.rise, end: low.set }];
    if (high.kind === 'ok') {
      return [
        { start: low.rise, end: high.rise },
        { start: high.set, end: low.set },
      ];
    }
    return []; // never drops to `lower` yet crosses `upper` — impossible together
  }

  // low.kind === 'always-above': the sun never sinks out of the band's bottom.
  // Never leaves the top either, so it is always brighter than the band.
  if (high.kind === 'always-above') return [];
  // It dips below `upper` around solar *midnight* rather than around sunrise, so
  // the band is open at both ends of the day. Not only the midnight sun: Tromsø
  // in late July still has a proper sunrise and sunset, yet the sun never falls
  // to -4°, so golden hour runs unbroken through the small hours.
  if (high.kind === 'ok') {
    return [
      { start: dayStart, end: high.rise },
      { start: high.set, end: dayEnd },
    ];
  }
  // Never reaches `upper` at all: inside the band the entire day.
  return [{ start: dayStart, end: dayEnd }];
}

export function sunTimes(latitude: number, longitude: number, date: Date): SunTimes {
  const lat = clamp(latitude, -MAX_LAT, MAX_LAT);
  const meanNoonJD = meanSolarNoonJulianDay(longitude, date);
  const noonJD = solarNoonJulianDay(longitude, date);
  const solarNoon = dateFromJulianDay(noonJD);
  const solarMidnight = dateFromJulianDay(noonJD - 0.5);

  const at = (altitude: number) => crossingsAt(lat, meanNoonJD, altitude);
  const rise = (r: CrossingResult) => (r.kind === 'ok' ? r.rise : null);
  const set = (r: CrossingResult) => (r.kind === 'ok' ? r.set : null);

  const day = at(SUN_ALTITUDE.sunrise);
  const civil = at(SUN_ALTITUDE.civil);
  const nautical = at(SUN_ALTITUDE.nautical);
  const astronomical = at(SUN_ALTITUDE.astronomical);

  const sunrise = rise(day);
  const sunset = set(day);

  const noonPos = sunPosition(lat, longitude, solarNoon);
  const midnightPos = sunPosition(lat, longitude, solarMidnight);

  const polar: PolarState =
    day.kind === 'always-above' ? 'midnight-sun' : day.kind === 'always-below' ? 'polar-night' : 'none';

  return {
    dayStart: dateFromJulianDay(noonJD - 0.5),
    dayEnd: dateFromJulianDay(noonJD + 0.5),
    solarNoon,
    solarMidnight,
    sunrise,
    sunset,
    goldenHour: bandWindows(
      lat,
      meanNoonJD,
      noonJD,
      SUN_ALTITUDE.goldenLower,
      SUN_ALTITUDE.goldenUpper,
    ),
    blueHour: bandWindows(lat, meanNoonJD, noonJD, SUN_ALTITUDE.blueLower, SUN_ALTITUDE.blueUpper),
    civilDawn: rise(civil),
    civilDusk: set(civil),
    nauticalDawn: rise(nautical),
    nauticalDusk: set(nautical),
    astronomicalDawn: rise(astronomical),
    astronomicalDusk: set(astronomical),
    dayLengthMinutes:
      sunrise && sunset ? (sunset.getTime() - sunrise.getTime()) / 60_000 : null,
    polar,
    maxAltitude: noonPos.altitude,
    minAltitude: midnightPos.altitude,
  };
}

/* ── Phase ─────────────────────────────────────────────────────────────────── */

/**
 * Mutually exclusive bands, for the slider's colour-graded track. These are the
 * photographer's carve-up, not the navigator's: `golden` and `blue` take their
 * conventional slices, and what is left of civil twilight below blue hour is
 * folded into `nautical` rather than given a name nobody uses in the field.
 */
export type SunPhase = 'day' | 'golden' | 'blue' | 'nautical' | 'astronomical' | 'night';

export function phaseForAltitude(altitude: number): SunPhase {
  if (altitude >= SUN_ALTITUDE.goldenUpper) return 'day';
  if (altitude >= SUN_ALTITUDE.goldenLower) return 'golden';
  if (altitude >= SUN_ALTITUDE.blueLower) return 'blue';
  if (altitude >= SUN_ALTITUDE.nautical) return 'nautical';
  if (altitude >= SUN_ALTITUDE.astronomical) return 'astronomical';
  return 'night';
}

export const phaseAt = (latitude: number, longitude: number, date: Date): SunPhase =>
  phaseForAltitude(sunPosition(latitude, longitude, date).altitude);

/* ── Day track ─────────────────────────────────────────────────────────────── */

export interface SunSample extends SunPosition {
  date: Date;
  phase: SunPhase;
}

export interface DayTrackOptions {
  /** Sampling interval. Default 5 minutes — 289 samples across a day. */
  stepMinutes?: number;
  /** Defaults to the solar day containing `date`: solar midnight to solar midnight. */
  from?: Date;
  to?: Date;
}

/**
 * The sun's whole path across one solar day. This is what draws the arc on the
 * map and colour-grades the slider track, and it is deliberately one pass: the
 * slider needs to scrub without recomputing anything.
 */
export function dayTrack(
  latitude: number,
  longitude: number,
  date: Date,
  options: DayTrackOptions = {},
): SunSample[] {
  const { stepMinutes = 5 } = options;
  if (!(stepMinutes > 0)) throw new RangeError('stepMinutes must be greater than zero');

  const noonJD = solarNoonJulianDay(longitude, date);
  const from = options.from ?? dateFromJulianDay(noonJD - 0.5);
  const to = options.to ?? dateFromJulianDay(noonJD + 0.5);
  if (to.getTime() < from.getTime()) throw new RangeError('`to` must not precede `from`');

  const step = stepMinutes * 60_000;
  const samples: SunSample[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += step) {
    const at = new Date(t);
    const position = sunPosition(latitude, longitude, at);
    samples.push({ ...position, date: at, phase: phaseForAltitude(position.altitude) });
  }
  return samples;
}
