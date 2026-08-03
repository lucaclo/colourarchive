/**
 * Spherical geodesy — distances, bearings, and the radius ring itself.
 *
 * A sphere, not an ellipsoid. Over the 1–50km Scout works at, the difference
 * between the two is a few metres in a few tens of kilometres; well inside the
 * error of "somewhere around here" and not worth carrying Vincenty for. Where
 * it would matter — the shadow geometry in Part 4b — the numbers come from
 * projected tiles, not from here.
 *
 * All angles in degrees, all distances in metres, all coordinates {lat, lon}.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** IUGG mean earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLon {
  lat: number;
  lon: number;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

/**
 * Wrap a longitude into [-180, 180).
 *
 * Short-circuits when it is already in range — not for speed but for exactness:
 * the modular round trip turns 179.9 into 179.90000000000003, and these values
 * get compared against map bounds.
 */
export const wrapLongitude = (lon: number): number =>
  lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;

/** Clamp a latitude to the poles. */
export const clampLatitude = (lat: number): number => Math.min(90, Math.max(-90, lat));

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the spherical law of cosines: the latter loses
 * precision badly for short distances, which is the only kind Scout measures.
 */
export function distance(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const dφ = (b.lat - a.lat) * RAD;
  const dλ = (b.lon - a.lon) * RAD;
  const h =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from true north. */
export function initialBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * RAD;
  const φ2 = b.lat * RAD;
  const dλ = (b.lon - a.lon) * RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return norm360(Math.atan2(y, x) * DEG);
}

/**
 * The point `distanceM` metres from `from` along `bearing`.
 *
 * Longitude comes back unwrapped — it can fall outside ±180 if you walk over
 * the antimeridian. `circleRing` depends on that; wrap it yourself if you are
 * handing the result to something that wants a canonical coordinate.
 */
export function destination(from: LatLon, bearing: number, distanceM: number): LatLon {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = bearing * RAD;
  const φ1 = from.lat * RAD;
  const λ1 = from.lon * RAD;

  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.min(1, Math.max(-1, sinφ2)));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * sinφ2,
    );

  return { lat: φ2 * DEG, lon: λ2 * DEG };
}

/**
 * The point a `fraction` of the way from `a` to `b` along the great circle.
 *
 * Spherical interpolation rather than walking the initial bearing: a bearing is
 * only constant along a rhumb line, and over the tens of kilometres a sightline
 * covers the two paths separate by enough to sample the wrong ridge. It also
 * behaves at the poles, where a bearing walk does not.
 *
 * Antipodal endpoints have no unique great circle between them and are refused
 * rather than resolved arbitrarily — nothing in Scout asks for one, and a silent
 * answer there would be a coin toss.
 */
export function intermediatePoint(a: LatLon, b: LatLon, fraction: number): LatLon {
  if (!Number.isFinite(fraction)) throw new RangeError('fraction must be a number');
  const φ1 = a.lat * RAD;
  const λ1 = a.lon * RAD;
  const φ2 = b.lat * RAD;
  const λ2 = b.lon * RAD;
  const δ = distance(a, b) / EARTH_RADIUS_M;
  if (δ === 0) return { lat: a.lat, lon: a.lon };
  if (Math.abs(Math.sin(δ)) < 1e-12) throw new RangeError('endpoints are antipodal');

  const A = Math.sin((1 - fraction) * δ) / Math.sin(δ);
  const B = Math.sin(fraction * δ) / Math.sin(δ);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return {
    lat: Math.atan2(z, Math.hypot(x, y)) * DEG,
    lon: Math.atan2(y, x) * DEG,
  };
}

/**
 * A closed ring of points at `radiusM` from `centre`, as [lon, lat] pairs.
 *
 * True geodesic circle, not an ellipse drawn in screen space: at 50km and 60°N
 * the two differ by enough to see. Longitudes are left *continuous* rather than
 * wrapped into ±180 — a ring straddling the antimeridian must run …179, 180,
 * 181… or every renderer draws a band right across the map instead of a circle.
 */
export function circleRing(centre: LatLon, radiusM: number, steps = 128): [number, number][] {
  if (!(radiusM > 0)) throw new RangeError('radiusM must be greater than zero');
  if (!Number.isInteger(steps) || steps < 8) throw new RangeError('steps must be an integer ≥ 8');

  const ring: [number, number][] = [];
  let previousLon = centre.lon;
  for (let i = 0; i <= steps; i++) {
    const bearing = (i / steps) * 360;
    const point = destination(centre, bearing, radiusM);
    // Keep the run continuous with whatever came before it.
    let lon = point.lon;
    while (lon - previousLon > 180) lon -= 360;
    while (previousLon - lon > 180) lon += 360;
    previousLon = lon;
    ring.push([lon, point.lat]);
  }
  // Close it exactly — a float that is merely very close is not a valid ring.
  ring[ring.length - 1] = [ring[0][0], ring[0][1]];
  return ring;
}

/** The radius ring as a GeoJSON Feature, ready to hand straight to MapLibre. */
export function circleFeature(
  centre: LatLon,
  radiusM: number,
  steps = 128,
): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: { radiusM },
    geometry: { type: 'Polygon', coordinates: [circleRing(centre, radiusM, steps)] },
  };
}

/**
 * Bounding box of the radius ring as [west, south, east, north].
 *
 * Derived from the ring rather than from a flat-earth approximation, so it is
 * correct at high latitude where a circle's east–west extent is much wider in
 * degrees than its north–south one.
 */
export function boundingBox(
  centre: LatLon,
  radiusM: number,
): [number, number, number, number] {
  const ring = circleRing(centre, radiusM, 128);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  // A circle that *encloses* a pole wraps the whole way round, so its east–west
  // extent is the entire globe and it reaches the pole itself. Testing the
  // vertices for this does not work: a 50km ring around 89.9°N contains the
  // pole while every one of its vertices sits between 89.45° and 89.65°. Ask
  // whether the pole is inside instead.
  const northPoleInside = distance(centre, { lat: 90, lon: centre.lon }) <= radiusM;
  const southPoleInside = distance(centre, { lat: -90, lon: centre.lon }) <= radiusM;
  if (northPoleInside || southPoleInside) {
    return [-180, southPoleInside ? -90 : south, 180, northPoleInside ? 90 : north];
  }
  return [west, south, east, north];
}

/** True when `point` lies within `radiusM` of `centre`. */
export const withinRadius = (centre: LatLon, point: LatLon, radiusM: number): boolean =>
  distance(centre, point) <= radiusM;

/* ── Presentation ──────────────────────────────────────────────────────────── */

/**
 * "850 m", "2.4 km", "18 km" — one decimal only where it earns it.
 *
 * The branch is at 9.95 rather than 10 so that a distance which would *round*
 * to ten never prints as "10.0 km" one metre before it prints as "10 km".
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  const km = metres / 1000;
  return km < 9.95 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'] as const;

/** Nearest 16-point compass name for a bearing. */
export const compassPoint = (bearing: number): string =>
  COMPASS[Math.round(norm360(bearing) / 22.5) % 16];
