/**
 * What a single spot can see of the sky, and therefore when the sun reaches it.
 *
 * The shadow overlay answers "where is the shade right now". This answers the
 * question a photographer actually asks, which is the other way round and about
 * one place: *when is that doorway lit?* Standing at a point, every building
 * around it hides a slice of the sky — a wall 10m high and 10m away blocks
 * everything below 45° in that direction. Collect the highest obstruction for
 * every compass bearing and you have the point's skyline: a horizon profile.
 * After that the whole day is a lookup, because the sun is lit at that spot
 * exactly when its altitude clears the profile at its azimuth.
 *
 * Doing it this way rather than by testing the point against every cast shadow
 * at every minute is what makes it instant. The profile costs one pass over the
 * nearby buildings; each of the day's 1,441 minutes then costs an array index.
 *
 * Two things this deliberately does not model, both of which the UI says out
 * loud rather than quietly absorbing:
 *
 *   - **Terrain.** A valley wall is a far bigger obstruction than any building
 *     and it is not in here. The profile is buildings only.
 *   - **Buildings that were never loaded.** Only what is in the vector tiles the
 *     map has fetched can be seen, so the count of what was considered travels
 *     with the answer.
 *
 * Pure. No map, no DOM.
 */

import { type LatLon } from './geo';
import { type SunSample } from './sun';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** A footprint ring of [lon, lat], as the vector tiles give them. */
export type Ring = [number, number][];

export interface SkylineBuilding {
  ring: Ring;
  height: number;
  estimated?: boolean;
}

export interface SkylineOptions {
  /**
   * Bearing resolution, degrees. Half a degree is about two minutes of the sun's
   * travel, which is finer than a photographer can act on and cheap enough not
   * to think about.
   */
  stepDeg?: number;
  /**
   * How far out a building can still matter, metres. At 1.5km even a 200m tower
   * only reaches 7.6°, but at sunrise 7.6° is the difference between the whole
   * morning and none of it, so the default is generous rather than tidy.
   */
  radiusM?: number;
}

const DEFAULTS = { stepDeg: 0.5, radiusM: 1500 } as const;

export interface Skyline {
  /** Bearing resolution in degrees; `altitudes` has 360/step entries. */
  stepDeg: number;
  /** Highest obstruction in each bearing bin, degrees above the horizon. */
  altitudes: Float64Array;
  /** True when the point is inside a building footprint — never directly lit. */
  enclosed: boolean;
  /** Buildings that contributed something to the profile. */
  considered: number;
  /** How many of those had a height guessed from a storey count. */
  estimated: number;
  /** The highest point on the profile, and the bearing it is on. */
  peakAltitude: number;
  peakBearing: number;
  /** The radius actually searched, metres. */
  radiusM: number;
}

/* ── Local plane ───────────────────────────────────────────────────────────── */

/**
 * Metres east and north of the query point.
 *
 * An equirectangular projection about the point itself. Over the radius this
 * works at — a kilometre or two — the error is centimetres, and the alternative
 * is doing spherical trigonometry inside the inner loop of a ray cast.
 */
function localFrame(origin: LatLon) {
  const mPerDegLat = 111_132.92 - 559.82 * Math.cos(2 * origin.lat * DEG);
  const mPerDegLon = 111_412.84 * Math.cos(origin.lat * DEG) - 93.5 * Math.cos(3 * origin.lat * DEG);
  return (lon: number, lat: number): [number, number] => [
    (lon - origin.lon) * mPerDegLon,
    (lat - origin.lat) * mPerDegLat,
  ];
}

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Bearing of a local point from the origin: clockwise from north. */
const bearingOf = (x: number, y: number) => norm360(Math.atan2(x, y) * RAD);

/**
 * Is the origin inside this ring? Ray casting along +x.
 *
 * Standing inside a building means no direct sun ever, which is a different
 * answer from "in shadow at the moment" and has to be said differently.
 */
function containsOrigin(points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > 0 !== yj > 0 && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ── The profile ───────────────────────────────────────────────────────────── */

/**
 * Build the skyline seen from `point`.
 *
 * For every wall in range, work out which bearings it covers and how high it
 * stands at each of them, then keep the highest. The height at a bearing comes
 * from where the ray at that bearing actually crosses the wall, not from the
 * wall's nearest corner — filling a whole span with the nearest distance would
 * quietly claim shade along the edges of every building in the city.
 */
export function buildSkyline(
  point: LatLon,
  buildings: SkylineBuilding[],
  options: SkylineOptions = {},
): Skyline {
  const stepDeg = options.stepDeg ?? DEFAULTS.stepDeg;
  const radiusM = options.radiusM ?? DEFAULTS.radiusM;
  const bins = Math.max(4, Math.round(360 / stepDeg));
  const altitudes = new Float64Array(bins);
  const project = localFrame(point);

  let enclosed = false;
  let considered = 0;
  let estimated = 0;

  for (const building of buildings) {
    if (!(building.height > 0)) continue;
    if (building.ring.length < 3) continue;

    const points = building.ring.map(([lon, lat]) => project(lon, lat));

    // Cheap reject on the bounding box before any trigonometry. Most of what a
    // viewport hands over is nowhere near the point being asked about.
    let near = Infinity;
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    for (const [x, y] of points) {
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
      const d = Math.hypot(x, y);
      if (d < near) near = d;
    }
    if (west > radiusM || east < -radiusM || south > radiusM || north < -radiusM) continue;
    // The corner nearest the point sets the ceiling on what this building can
    // reach; if that is under the profile everywhere it faces, it changes nothing.
    if (near > radiusM) continue;

    if (containsOrigin(points)) {
      enclosed = true;
      considered++;
      if (building.estimated) estimated++;
      continue;
    }

    let touched = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      if (ex === 0 && ey === 0) continue;

      // The arc this wall covers, taken the short way round. Valid because the
      // point is outside the footprint, so no single wall can subtend 180°.
      const from = bearingOf(a[0], a[1]);
      const to = bearingOf(b[0], b[1]);
      let sweep = to - from;
      if (sweep > 180) sweep -= 360;
      if (sweep < -180) sweep += 360;

      const first = sweep >= 0 ? from : from + sweep;
      const count = Math.floor(Math.abs(sweep) / stepDeg) + 2;

      for (let k = 0; k <= count; k++) {
        const bearing = first + k * stepDeg;
        // Snap to the bin grid so a wall and its neighbour land on the same bins.
        const bin = Math.round(norm360(bearing) / stepDeg) % bins;
        const theta = bin * stepDeg * DEG;
        const ux = Math.sin(theta);
        const uy = Math.cos(theta);

        const denom = ux * ey - uy * ex;
        if (Math.abs(denom) < 1e-12) continue;
        const t = (a[0] * ey - a[1] * ex) / denom;
        if (!(t > 0) || t > radiusM) continue;
        const s = (a[0] * uy - a[1] * ux) / denom;
        if (s < 0 || s > 1) continue;

        const apparent = Math.atan2(building.height, t) * RAD;
        if (apparent > altitudes[bin]) {
          altitudes[bin] = apparent;
          touched = true;
        }
      }
    }

    if (touched) {
      considered++;
      if (building.estimated) estimated++;
    }
  }

  let peakAltitude = 0;
  let peakBearing = 0;
  for (let bin = 0; bin < bins; bin++) {
    if (altitudes[bin] > peakAltitude) {
      peakAltitude = altitudes[bin];
      peakBearing = bin * stepDeg;
    }
  }

  return {
    stepDeg,
    altitudes,
    enclosed,
    considered,
    estimated,
    peakAltitude,
    peakBearing,
    radiusM,
  };
}

/**
 * How high the obstruction is on a given bearing, degrees.
 *
 * Interpolated between bins rather than snapped to one. The profile is a
 * sampling of a continuous silhouette, and stepping it makes a sunrise arrive
 * in visible jerks as the azimuth crosses bin edges.
 */
export function obstructionAt(skyline: Skyline, azimuth: number): number {
  const bins = skyline.altitudes.length;
  const exact = norm360(azimuth) / skyline.stepDeg;
  const low = Math.floor(exact) % bins;
  const high = (low + 1) % bins;
  const t = exact - Math.floor(exact);
  return skyline.altitudes[low] * (1 - t) + skyline.altitudes[high] * t;
}

/**
 * Is the sun on this spot?
 *
 * Two conditions, and they are different claims: the sun has to be above the
 * horizon at all, and above the buildings in the direction it is coming from.
 */
export function isSunlit(skyline: Skyline, azimuth: number, altitude: number): boolean {
  if (skyline.enclosed) return false;
  if (!(altitude > 0)) return false;
  return altitude > obstructionAt(skyline, azimuth);
}

/**
 * Fold a terrain horizon into a building skyline.
 *
 * The two profiles are measured completely differently — this file walks exact
 * wall geometry over tens of metres, `terrain.ts` ray-casts a sampled elevation
 * grid over tens of kilometres — and neither can stand in for the other. A
 * courtyard in a mountain town is shaded by its own walls at nine and by the
 * mountain at four. Kept apart until here so that each stays honest about its
 * own method, then combined by the only rule that makes sense: at any bearing,
 * what blocks the sun is whichever is higher.
 *
 * Resampled by bearing rather than by index, so the two profiles need not share
 * a resolution.
 */
export function mergeHorizon(skyline: Skyline, horizon: {
  stepDeg: number;
  altitudes: Float64Array;
}): Skyline {
  const merged = new Float64Array(skyline.altitudes);
  const bins = merged.length;
  const otherBins = horizon.altitudes.length;
  if (!otherBins) return skyline;

  for (let bin = 0; bin < bins; bin++) {
    const bearing = bin * skyline.stepDeg;
    const exact = norm360(bearing) / horizon.stepDeg;
    const low = Math.floor(exact) % otherBins;
    const high = (low + 1) % otherBins;
    const t = exact - Math.floor(exact);
    const value = horizon.altitudes[low] * (1 - t) + horizon.altitudes[high] * t;
    if (value > merged[bin]) merged[bin] = value;
  }

  let peakAltitude = 0;
  let peakBearing = 0;
  for (let bin = 0; bin < bins; bin++) {
    if (merged[bin] > peakAltitude) {
      peakAltitude = merged[bin];
      peakBearing = bin * skyline.stepDeg;
    }
  }

  return { ...skyline, altitudes: merged, peakAltitude, peakBearing };
}

/* ── The day, as windows ───────────────────────────────────────────────────── */

export interface LightWindow {
  lit: boolean;
  /** Minute index into the day, inclusive. */
  startMinute: number;
  /** Minute index into the day, exclusive. */
  endMinute: number;
  /** True when the sun is below the horizon for the whole window. */
  belowHorizon: boolean;
}

/**
 * Split a day into runs of lit and unlit.
 *
 * Sampled off the day track the slider already holds, so this costs one pass
 * and cannot disagree with what the slider shows.
 */
export function lightWindows(skyline: Skyline, samples: SunSample[]): LightWindow[] {
  if (!samples.length) return [];
  const windows: LightWindow[] = [];
  const litAt = (i: number) => isSunlit(skyline, samples[i].azimuth, samples[i].altitude);
  const downAt = (i: number) => !(samples[i].altitude > 0);

  let current: LightWindow = {
    lit: litAt(0),
    startMinute: 0,
    endMinute: 1,
    belowHorizon: downAt(0),
  };
  for (let i = 1; i < samples.length; i++) {
    const lit = litAt(i);
    const down = downAt(i);
    if (lit === current.lit && down === current.belowHorizon) {
      current.endMinute = i + 1;
      continue;
    }
    current.endMinute = i;
    windows.push(current);
    current = { lit, startMinute: i, endMinute: i + 1, belowHorizon: down };
  }
  windows.push(current);
  return windows;
}

export interface LightSummary {
  /** First minute of direct sun, or null if the spot never gets any. */
  firstLightMinute: number | null;
  /** Last minute of direct sun, or null. */
  lastLightMinute: number | null;
  /** Total minutes of direct sun across the day. */
  litMinutes: number;
  /** Windows of shade that fall while the sun is up — the interesting ones. */
  shadeWindows: LightWindow[];
  /** The longest unbroken stretch of direct sun. */
  longestRun: LightWindow | null;
}

export function summariseLight(windows: LightWindow[]): LightSummary {
  const lit = windows.filter((w) => w.lit);
  const litMinutes = lit.reduce((total, w) => total + (w.endMinute - w.startMinute), 0);
  const longestRun = lit.reduce<LightWindow | null>(
    (best, w) =>
      !best || w.endMinute - w.startMinute > best.endMinute - best.startMinute ? w : best,
    null,
  );
  return {
    firstLightMinute: lit.length ? lit[0].startMinute : null,
    lastLightMinute: lit.length ? lit[lit.length - 1].endMinute - 1 : null,
    litMinutes,
    // Shade before dawn is not news. Shade at ten in the morning is.
    shadeWindows: windows.filter((w) => !w.lit && !w.belowHorizon),
    longestRun,
  };
}

/**
 * When the spot next changes state, from a given minute.
 *
 * The number that turns a timeline into a decision: *lit in 24 minutes* is
 * something you can act on standing in the street.
 */
export function nextChange(
  windows: LightWindow[],
  minute: number,
): { lit: boolean; atMinute: number; inMinutes: number } | null {
  const here = windows.find((w) => minute >= w.startMinute && minute < w.endMinute);
  if (!here) return null;
  const next = windows[windows.indexOf(here) + 1];
  if (!next) return null;
  return { lit: next.lit, atMinute: next.startMinute, inMinutes: next.startMinute - minute };
}
