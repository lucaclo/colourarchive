/**
 * Meteor showers: when each one peaks, when its radiant is up at the pin, and
 * roughly how many you might see an hour once the moon and the sky's own
 * brightness have had their say.
 *
 * The table is the major showers from the International Meteor Organization's
 * working list: peak by solar longitude (so it lands on the right date every
 * year), radiant at peak and its daily drift, ZHR, population index r, and a
 * slope B for how fast activity falls away from the peak, ZHR·10^(−B·|Δλ|).
 * B is rounded and the same on both sides of the peak, which real showers
 * aren't; the Quadrantids' few-hour peak is the reason it is there at all.
 *
 * The rate is the standard one: HR = ZHR · sin(radiant altitude) ·
 * r^(LM − 6.5), where LM is the faintest star the sky allows. It's an upper
 * figure for one observer with the whole sky in view. A camera with a 24mm
 * lens sees a fraction of that, and the panel says "at best" because of it.
 *
 * Pure: the panel does the drawing, light-pollution.ts supplies the zone.
 */

import { equatorialToHorizontal } from './galactic';
import { moonIllumination, moonPosition } from './moon';
import { limitingMagnitude } from './stars';
import { julianDay, dateFromJulianDay, solarState, sunPosition } from './sun';

export interface Shower {
  code: string;
  name: string;
  /** Solar longitude of the peak, degrees (J2000). */
  peak: number;
  /** Solar longitudes the shower is active between. */
  from: number;
  to: number;
  /** Radiant at peak, degrees. */
  ra: number;
  dec: number;
  /** Radiant drift, degrees per degree of solar longitude (≈ per day). */
  dra: number;
  ddec: number;
  zhr: number;
  r: number;
  /** Activity slope either side of the peak, per degree of solar longitude. */
  slope: number;
  /** km/s. Slow showers make longer, fainter trails. */
  speed: number;
}

export const SHOWERS: readonly Shower[] = [
  { code: 'QUA', name: 'Quadrantids', peak: 283.15, from: 277, to: 291, ra: 230, dec: 49, dra: 0, ddec: 0, zhr: 110, r: 2.1, slope: 2.5, speed: 41 },
  { code: 'LYR', name: 'Lyrids', peak: 32.32, from: 24, to: 40, ra: 271, dec: 34, dra: 1.1, ddec: 0, zhr: 18, r: 2.1, slope: 0.22, speed: 49 },
  { code: 'ETA', name: 'Eta Aquariids', peak: 45.5, from: 29, to: 67, ra: 338, dec: -1, dra: 0.9, ddec: 0.4, zhr: 50, r: 2.4, slope: 0.08, speed: 66 },
  { code: 'SDA', name: 'Southern Delta Aquariids', peak: 127, from: 110, to: 150, ra: 340, dec: -16, dra: 0.8, ddec: 0.2, zhr: 25, r: 2.5, slope: 0.09, speed: 41 },
  { code: 'CAP', name: 'Alpha Capricornids', peak: 127, from: 101, to: 143, ra: 307, dec: -10, dra: 0.9, ddec: 0.3, zhr: 5, r: 2.5, slope: 0.1, speed: 23 },
  { code: 'PER', name: 'Perseids', peak: 140, from: 115, to: 151, ra: 48, dec: 58, dra: 1.35, ddec: 0.12, zhr: 100, r: 2.2, slope: 0.2, speed: 59 },
  { code: 'DRA', name: 'Draconids', peak: 195.4, from: 193, to: 198, ra: 262, dec: 54, dra: 0, ddec: 0, zhr: 10, r: 2.6, slope: 1, speed: 20 },
  { code: 'STA', name: 'Southern Taurids', peak: 197, from: 167, to: 238, ra: 32, dec: 9, dra: 0.8, ddec: 0.3, zhr: 5, r: 2.3, slope: 0.03, speed: 27 },
  { code: 'ORI', name: 'Orionids', peak: 208, from: 189, to: 225, ra: 95, dec: 16, dra: 0.7, ddec: 0.1, zhr: 20, r: 2.5, slope: 0.12, speed: 66 },
  { code: 'NTA', name: 'Northern Taurids', peak: 230, from: 207, to: 258, ra: 58, dec: 22, dra: 0.8, ddec: 0.2, zhr: 5, r: 2.3, slope: 0.03, speed: 29 },
  { code: 'LEO', name: 'Leonids', peak: 235.27, from: 223, to: 248, ra: 152, dec: 22, dra: 0.7, ddec: -0.4, zhr: 15, r: 2.5, slope: 0.39, speed: 71 },
  { code: 'GEM', name: 'Geminids', peak: 262.2, from: 252, to: 268, ra: 112, dec: 33, dra: 1.0, ddec: -0.1, zhr: 150, r: 2.6, slope: 0.39, speed: 35 },
  { code: 'URS', name: 'Ursids', peak: 270.7, from: 265, to: 274, ra: 217, dec: 76, dra: 0, ddec: 0, zhr: 10, r: 3.0, slope: 0.6, speed: 33 },
];

const J2000 = 2451545;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** Signed difference a − b, wrapped to −180…180. */
const dLon = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export function solarLongitude(date: Date): number {
  return norm360(solarState((julianDay(date) - J2000) / 36525).apparentLongitude);
}

/** The instant the sun reaches longitude `lambda` in `year`, to about a minute. */
export function dateAtSolarLongitude(lambda: number, year: number): Date {
  // The sun is at 0° near 20 March and moves just under a degree a day.
  let jd = julianDay(new Date(Date.UTC(year, 2, 20))) + norm360(lambda) / 0.9856;
  const solve = () => { for (let i = 0; i < 6; i++) jd -= dLon(solarLongitude(dateFromJulianDay(jd)), lambda) / 0.9856; };
  solve();
  // Late-December longitudes start out in the next calendar year from 20 March.
  const y = dateFromJulianDay(jd).getUTCFullYear();
  if (y !== year) { jd += (year - y) * 365.2422; solve(); }
  return dateFromJulianDay(jd);
}

const inside = (lambda: number, from: number, to: number) =>
  from <= to ? lambda >= from && lambda <= to : lambda >= from || lambda <= to;

export function isActive(shower: Shower, date: Date): boolean {
  return inside(solarLongitude(date), shower.from, shower.to);
}

/** ZHR at this moment: the peak figure falling away either side of it. 0 outside the active range. */
export function zhrAt(shower: Shower, date: Date): number {
  const lambda = solarLongitude(date);
  if (!inside(lambda, shower.from, shower.to)) return 0;
  return shower.zhr * 10 ** (-shower.slope * Math.abs(dLon(lambda, shower.peak)));
}

/** The radiant at this moment, drifted from its peak position. */
export function radiantAt(shower: Shower, date: Date): { ra: number; dec: number } {
  const d = dLon(solarLongitude(date), shower.peak);
  return { ra: norm360(shower.ra + shower.dra * d), dec: shower.dec + shower.ddec * d };
}

/**
 * The faintest star a site allows on a moonless, astronomically dark night,
 * from its light-pollution zone (0 darkest … 13 brightest). A rough stated
 * convention, like stars.ts's moonlight penalty: about 6.5 at a dark site,
 * losing a third of a magnitude a zone past zone 2.
 */
export function siteLimitingMagnitude(zone: number | null): number {
  if (zone === null) return 6.5;
  return Math.max(3, 6.5 - Math.max(0, zone - 2) * 0.33);
}

export interface MeteorSample {
  at: Date;
  radiantAltitude: number;
  limitingMag: number;
  /** Meteors an hour, at best. */
  rate: number;
}

export interface MeteorNight {
  shower: Shower;
  samples: MeteorSample[];
  best: MeteorSample | null;
  /** When the radiant is above 10° and the sun below −12°. */
  window: { start: Date; end: Date } | null;
  moon: { fraction: number; upAtBest: boolean };
  /** True when the radiant never clears 10° at this latitude during darkness. */
  neverUp: boolean;
}

const STEP_MIN = 10;

/** One night at a place: the 24 hours from `noon` (local noon, so the night is one piece). */
export function meteorNight(shower: Shower, lat: number, lon: number, noon: Date, zone: number | null = null): MeteorNight {
  const site = siteLimitingMagnitude(zone);
  const start = noon;
  const samples: MeteorSample[] = [];
  for (let m = 0; m <= 24 * 60; m += STEP_MIN) {
    const at = new Date(start.getTime() + m * 60e3);
    const sun = sunPosition(lat, lon, at).altitude;
    if (sun > -6) continue;
    const { ra, dec } = radiantAt(shower, at);
    const radiantAltitude = equatorialToHorizontal(ra, dec, lat, lon, at).altitude;
    const moonAlt = moonPosition(lat, lon, at).altitude;
    const frac = moonIllumination(at).fraction;
    const limitingMag = limitingMagnitude(sun, moonAlt, frac, site);
    const zhr = zhrAt(shower, at);
    const rate = radiantAltitude > 0 && zhr > 0
      ? zhr * Math.sin((radiantAltitude * Math.PI) / 180) * shower.r ** (limitingMag - 6.5)
      : 0;
    samples.push({ at, radiantAltitude, limitingMag, rate });
  }
  const best = samples.reduce<MeteorSample | null>((b, s) => (s.rate > (b?.rate ?? 0) ? s : b), null);
  const dark = samples.filter((s) => s.radiantAltitude >= 10 && sunPosition(lat, lon, s.at).altitude <= -12);
  const window = dark.length ? { start: dark[0].at, end: dark[dark.length - 1].at } : null;
  return {
    shower,
    samples,
    best,
    window,
    moon: { fraction: moonIllumination(best?.at ?? noon).fraction, upAtBest: best ? moonPosition(lat, lon, best.at).altitude > 0 : false },
    neverUp: dark.length === 0,
  };
}

export interface UpcomingShower {
  shower: Shower;
  peak: Date;
  /** Days from `from` to the peak; negative while it's still active after it. */
  days: number;
  active: boolean;
}

/** Every shower's next peak. Showers active now come first, busiest first; then the soonest. */
export function upcomingShowers(from: Date): UpcomingShower[] {
  const year = from.getUTCFullYear();
  return SHOWERS.map((shower) => {
    let peak = dateAtSolarLongitude(shower.peak, year);
    const active = isActive(shower, from);
    // Already past this year's peak and no longer active: next year's.
    if (peak.getTime() < from.getTime() && !active) peak = dateAtSolarLongitude(shower.peak, year + 1);
    // Active, but the peak computed for this year is the *coming* one across New Year.
    if (active && peak.getTime() - from.getTime() > 180 * 864e5) peak = dateAtSolarLongitude(shower.peak, year - 1);
    return { shower, peak, days: (peak.getTime() - from.getTime()) / 864e5, active, zhr: zhrAt(shower, from) };
  })
    .sort((a, b) => Number(b.active) - Number(a.active) || (a.active ? b.zhr - a.zhr : a.days - b.days))
    .map(({ zhr: _zhr, ...u }) => u);
}
