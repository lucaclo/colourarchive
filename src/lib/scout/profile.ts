/**
 * Can I see it from here?
 *
 * Scout can already say where the sun will be and what the ground around a pin
 * looks like. It cannot say the plainest thing a scout wants to know before
 * driving somewhere, which is whether the subject is visible from the spot at
 * all. A ridge two kilometres out at the right height hides a mountain forty
 * kilometres beyond it, and nothing on a map view shows that.
 *
 * So: two points, the height field between them, and the straight line joining
 * the eye to the target. Where the ground rises above that line, the view is
 * blocked, and the profile says by how much and where — which is the useful
 * form of the answer, because "you are eleven metres short at the ridge 1.9 km
 * out" tells you to walk uphill and "you are two hundred metres short" tells you
 * to go somewhere else.
 *
 * Three things this gets right that a flat cross-section does not:
 *
 *   - **The earth is in the way.** Over forty kilometres the bulge between two
 *     points is about thirty metres, which is a building. It is added to the
 *     terrain rather than subtracted from the line, which is the same arithmetic
 *     and the more honest picture: obstacles really do rise into the sightline.
 *   - **Light bends.** The same 7/6 refraction allowance the terrain horizon
 *     uses, for the same reason — a distant ridge hides slightly less than bare
 *     geometry says.
 *   - **Eyes are not on the ground.** A standing photographer sees over a bank a
 *     ground-level sample says is solid, and a subject has height of its own.
 *     Both are explicit, and both default to something stated rather than zero.
 *
 * What it does not do: vegetation and buildings. The height field is bare earth,
 * so a clear sightline here means clear *terrain*, and a line of trees on the
 * ridge will still be there when you arrive. `skyline.ts` knows about buildings;
 * this deliberately does not merge with it, because a view blocked by a tower is
 * a different problem from one blocked by a hill and merging them would hide
 * which you have.
 */

import { distance, initialBearing, intermediatePoint, type LatLon } from './geo';
import { elevationAt, type HeightField } from './terrain';

/** Refraction-corrected earth radius, metres. Same 7/6 as `terrain.ts`. */
const EFFECTIVE_EARTH_RADIUS_M = (7 / 6) * 6_371_008.8;

const DEG = 180 / Math.PI;

/**
 * Standard eye height, metres. A camera on a tripod, roughly, which is the thing
 * actually doing the looking here.
 */
export const DEFAULT_EYE_M = 1.6;

export interface ProfileSample {
  /** Along-ground distance from the viewer, metres. */
  distanceM: number;
  /** Bare-earth elevation, metres above sea level. Null outside the field. */
  elevationM: number | null;
  /**
   * How much the earth's curvature lifts this point towards the sightline,
   * metres. Zero at both ends, greatest in the middle.
   */
  bulgeM: number;
  /** Height of the straight sightline above sea level here, metres. */
  sightlineM: number;
  /**
   * Sightline minus effective ground. Negative means the ground is in the way,
   * and by how much.
   */
  clearanceM: number | null;
}

export interface LineOfSight {
  from: LatLon;
  to: LatLon;
  /** Great-circle distance between the two, metres. */
  distanceM: number;
  bearing: number;
  /** Terrain elevation under each end, metres. Null when off the field. */
  fromGroundM: number | null;
  toGroundM: number | null;
  eyeM: number;
  targetM: number;
  samples: ProfileSample[];
  /** True when nothing rises into the line. False when something does. */
  clear: boolean;
  /**
   * The tightest point on the line: the smallest clearance and where it is.
   * When `clear` is false this is the worst blockage, not merely the closest
   * approach — they are the same measurement with a different sign.
   */
  minClearanceM: number | null;
  minClearanceAtM: number | null;
  /**
   * How much higher the viewer would have to be for the line to just clear
   * everything, metres. Zero when it already does, null when unanswerable.
   */
  requiredRiseM: number | null;
  /** Apparent altitude of the target above the viewer's horizontal, degrees. */
  targetAltitudeDeg: number | null;
  /** Samples that fell outside the loaded height field. */
  missingSamples: number;
  /** Whole sentence for the panel. */
  note: string;
}

export interface ProfileOptions {
  /** How many points to sample between the ends, inclusive. */
  samples?: number;
  /** Height of the eye above the ground at `from`, metres. */
  eyeM?: number;
  /** Height of the thing being looked at above the ground at `to`, metres. */
  targetM?: number;
}

/**
 * The ground between two points, and whether it gets in the way.
 *
 * Sampling is uniform in distance, and the count is a resolution choice rather
 * than an accuracy one: the height field underneath is 30–40 m per sample, so
 * asking for a thousand points between two places a kilometre apart interpolates
 * the same data more finely and does not learn anything new. The default is
 * chosen to land near one sample per grid cell over a typical scouting range.
 *
 * A sample outside the loaded field contributes nothing and is counted. Missing
 * ground cannot block a view, and pretending it is at sea level would clear
 * every sightline over the edge of the map.
 */
export function lineOfSight(
  field: HeightField,
  from: LatLon,
  to: LatLon,
  options: ProfileOptions = {},
): LineOfSight {
  const count = Math.max(2, Math.floor(options.samples ?? 256));
  const eyeM = options.eyeM ?? DEFAULT_EYE_M;
  const targetM = options.targetM ?? 0;
  const total = distance(from, to);
  const bearing = initialBearing(from, to);

  const fromGroundM = elevationAt(field, from.lon, from.lat);
  const toGroundM = elevationAt(field, to.lon, to.lat);

  const empty = (note: string): LineOfSight => ({
    from,
    to,
    distanceM: total,
    bearing,
    fromGroundM,
    toGroundM,
    eyeM,
    targetM,
    samples: [],
    clear: false,
    minClearanceM: null,
    minClearanceAtM: null,
    requiredRiseM: null,
    targetAltitudeDeg: null,
    missingSamples: 0,
    note,
  });

  if (total === 0) return empty('Both ends are the same point.');
  if (fromGroundM == null) return empty('The viewpoint is outside the loaded elevation.');
  if (toGroundM == null) return empty('The target is outside the loaded elevation.');

  const eyeAbs = fromGroundM + eyeM;
  const targetAbs = toGroundM + targetM;

  const samples: ProfileSample[] = [];
  let missingSamples = 0;
  let minClearanceM: number | null = null;
  let minClearanceAtM: number | null = null;
  let requiredRiseM = 0;

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const distanceM = t * total;
    const point = i === 0 ? from : i === count - 1 ? to : intermediatePoint(from, to, t);
    const elevationM = i === 0 ? fromGroundM : i === count - 1 ? toGroundM : elevationAt(field, point.lon, point.lat);
    // The classic earth-bulge term: d·(D−d)/2R, zero at both ends. Adding it to
    // the ground is equivalent to bending the line, and reads better on a chart.
    const bulgeM = (distanceM * (total - distanceM)) / (2 * EFFECTIVE_EARTH_RADIUS_M);
    const sightlineM = eyeAbs + t * (targetAbs - eyeAbs);
    const clearanceM = elevationM == null ? null : sightlineM - (elevationM + bulgeM);

    if (elevationM == null) missingSamples++;
    // The endpoints are the eye and the target themselves; they are always
    // "blocked" by their own ground and must not count as an obstruction.
    else if (i > 0 && i < count - 1) {
      if (minClearanceM == null || clearanceM! < minClearanceM) {
        minClearanceM = clearanceM!;
        minClearanceAtM = distanceM;
      }
      if (clearanceM! < 0) {
        // Raising the eye by r lifts the line here by (1−t)·r, so the rise this
        // obstacle demands is deficit/(1−t). The worst of them wins.
        const demanded = -clearanceM! / (1 - t);
        if (demanded > requiredRiseM) requiredRiseM = demanded;
      }
    }

    samples.push({ distanceM, elevationM, bulgeM, sightlineM, clearanceM });
  }

  const clear = minClearanceM != null && minClearanceM >= 0;
  // Apparent altitude of the target, with the same curvature allowance the
  // clearances use — this is the number that pairs with a sun altitude.
  const targetDrop = (total * total) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  const targetAltitudeDeg = Math.atan2(targetAbs - targetDrop - eyeAbs, total) * DEG;

  return {
    from,
    to,
    distanceM: total,
    bearing,
    fromGroundM,
    toGroundM,
    eyeM,
    targetM,
    samples,
    clear,
    minClearanceM,
    minClearanceAtM,
    requiredRiseM: clear ? 0 : requiredRiseM || null,
    targetAltitudeDeg,
    missingSamples,
    note: sightNote(clear, minClearanceM, minClearanceAtM, requiredRiseM, missingSamples, count),
  };
}

const metres = (m: number) => (m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`);
const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

function sightNote(
  clear: boolean,
  minClearance: number | null,
  minAt: number | null,
  rise: number,
  missing: number,
  count: number,
): string {
  const gap =
    missing === 0
      ? ''
      : missing >= count - 2
        ? ' None of the ground between was loaded, so this is not an answer.'
        : ` ${missing} of ${count} samples fell outside the loaded elevation and could not block anything.`;

  if (minClearance == null) return `Nothing between the two ends was measurable.${gap}`;
  if (clear) {
    return `Clear line of sight, with ${metres(minClearance)} to spare over the ground at ${km(minAt!)}.${gap} Bare earth only — trees and buildings are not in this.`;
  }
  return `Blocked — the ground at ${km(minAt!)} stands ${metres(-minClearance)} into the line. ${metres(rise)} higher would clear it.${gap}`;
}

/* ── Drawing it ────────────────────────────────────────────────────────────── */

export interface ProfileGeometry {
  /** SVG path for the ground, closed down to the baseline so it can be filled. */
  terrainPath: string;
  /** SVG path for the straight sightline, eye to target. */
  sightPath: string;
  /** Where the line first meets ground, as an [x, y] pair, or null when clear. */
  blockPoint: [number, number] | null;
  /** Sea-level metres at the top and bottom of the box, for the axis labels. */
  topM: number;
  bottomM: number;
}

/**
 * The cross-section as two SVG paths in a `width × height` box.
 *
 * Both curves share one vertical scale — the obvious thing, and the thing that
 * is quietly wrong in most elevation charts, which scale the terrain to fill the
 * box and then draw the sightline against a different axis. If they do not share
 * a scale, a line that crosses the ground on the chart is not the line that
 * crosses the ground on the hill.
 *
 * The ground includes its bulge, so what you see blocking the view on the chart
 * is exactly what blocks it in the arithmetic.
 */
export function profileGeometry(
  profile: LineOfSight,
  width: number,
  height: number,
  padding = 0.08,
): ProfileGeometry {
  const usable = profile.samples.filter((s) => s.elevationM != null);
  if (!usable.length || profile.distanceM === 0) {
    return { terrainPath: '', sightPath: '', blockPoint: null, topM: 0, bottomM: 0 };
  }

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of usable) {
    const ground = s.elevationM! + s.bulgeM;
    lo = Math.min(lo, ground, s.sightlineM);
    hi = Math.max(hi, ground, s.sightlineM);
  }
  // A dead-flat profile has no range to scale to; give it one so the ground does
  // not become a zero-height sliver pinned to the bottom of the box.
  if (hi - lo < 1) {
    const centre = (hi + lo) / 2;
    lo = centre - 0.5;
    hi = centre + 0.5;
  }
  const pad = (hi - lo) * padding;
  const topM = hi + pad;
  const bottomM = lo - pad;

  const x = (d: number) => (d / profile.distanceM) * width;
  const y = (m: number) => height - ((m - bottomM) / (topM - bottomM)) * height;

  const ground: string[] = [];
  for (const s of profile.samples) {
    if (s.elevationM == null) continue;
    ground.push(`${ground.length ? 'L' : 'M'}${x(s.distanceM).toFixed(2)} ${y(s.elevationM + s.bulgeM).toFixed(2)}`);
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const terrainPath = `${ground.join('')}L${x(last.distanceM).toFixed(2)} ${height}L${x(first.distanceM).toFixed(2)} ${height}Z`;

  const eye = profile.samples[0];
  const target = profile.samples[profile.samples.length - 1];
  const sightPath = `M${x(eye.distanceM).toFixed(2)} ${y(eye.sightlineM).toFixed(2)}L${x(target.distanceM).toFixed(2)} ${y(target.sightlineM).toFixed(2)}`;

  const blocker =
    profile.clear || profile.minClearanceAtM == null
      ? null
      : profile.samples.find((s) => s.distanceM === profile.minClearanceAtM);
  const blockPoint: [number, number] | null =
    blocker && blocker.elevationM != null
      ? [x(blocker.distanceM), y(blocker.elevationM + blocker.bulgeM)]
      : null;

  return { terrainPath, sightPath, blockPoint, topM, bottomM };
}
