/**
 * Ground shadows cast by buildings.
 *
 * The geometry is simpler than it looks. A building is a prism: a footprint
 * extruded straight up. The shadow it throws onto flat ground is the footprint
 * *plus* a copy of that footprint slid along the ground away from the sun, and
 * the region swept between the two. For a convex footprint that swept region is
 * exactly the convex hull of the two outlines together, which is one hull call
 * and no clipping library.
 *
 * Concave footprints — courtyards, L-shaped blocks — come out slightly too
 * generous, because the hull fills in the notch. That is a deliberate trade:
 * the alternative is a full Minkowski sum per building, per slider tick, for
 * several hundred buildings. The error is confined to the inside of a concave
 * corner and is small next to the uncertainty in the building height itself.
 *
 * Everything here is pure. No map, no DOM.
 */

import { destination, type LatLon } from './geo';
import { shadowBearing, shadowLengthRatio } from './sun';

/** A ring of [lon, lat] pairs, as GeoJSON gives them. */
export type Ring = [number, number][];

export interface ShadowOptions {
  /**
   * Longest shadow worth drawing, metres. Defaults to `maxShadowLength` for the
   * sun being cast from. Capped rather than drawn in full, and the cap is
   * reported so the caller can say the shadow is longer than shown.
   */
  maxLengthM?: number;
  /** Below this altitude there is no meaningful direct light. Degrees. */
  minAltitudeDeg?: number;
  /**
   * The footprint's own convex hull, if the caller already has it.
   *
   * Not a different answer — the *same* answer, reached with less work.
   * `hull(P ∪ (P+v)) = hull(hull(P) ∪ (hull(P)+v))`: the hull of a set and its
   * translate depends only on the hull of the set. And the hull of a building
   * does not change as the sun moves, while this function is called for every
   * building on every minute of a scrub.
   *
   * Measured over central London, 1,422 buildings, before this existed:
   * `convexHull` was 42% of all time spent scrubbing the slider — sorting the
   * same forty vertices of the same warehouse several hundred times a second.
   * Passing it in turns a sort of 2n points into a sort of 2h, where h is
   * usually four to eight.
   *
   * Left optional so the function still stands alone: given nothing, it hulls
   * the footprint itself and every result is identical either way.
   */
  hull?: Ring;
}

const MIN_ALTITUDE_DEG = 0.5;

/**
 * How far a cast shadow is still worth drawing, metres.
 *
 * cot(altitude) runs away at the horizon: at 1° a 30m building throws 1.7km, and
 * a flat cap of 1.5km meant that at dawn every building in view laid down the
 * same kilometre-and-a-half slab and the city disappeared under them.
 *
 * The geometry was right and the picture was not, because this model has no
 * occlusion. It projects onto flat ground and stops nothing: a kilometre of
 * shadow is drawn straight through every building, embankment and hill in its
 * path, none of which the light ever reached. The further from the building, the
 * more of that length is fiction. So the cap tightens as the sun grazes — down
 * to a few hundred metres, about as far as a shadow can run in a built-up street
 * before something real interrupts it — and `clipped` says when it bit.
 */
export function maxShadowLength(altitude: number): number {
  if (!(altitude > 0)) return 0;
  return 300 + 1200 * Math.min(1, altitude / 20);
}

export interface ShadowResult {
  ring: Ring;
  /**
   * How high above the ground this building's shadow still reaches, per vertex
   * of `ring`, in metres. The *ceiling* of the shaded volume.
   *
   * At the foot of the wall it is the building's own height; it falls away down
   * the shadow at tan(altitude) per metre and reaches zero at the tip. It is
   * what lets a renderer answer the question a flat polygon cannot: whether the
   * shadow is tall enough to land on whatever is standing at a given point, or
   * whether that thing rises out of it into the light.
   */
  ceilings: number[];
  /** Metres the shadow was cast, after any capping. */
  lengthM: number;
  /** True when the true shadow is longer than `lengthM`. */
  clipped: boolean;
  /**
   * The footprint's own `footprint[0]` — what `ceilings` is measured relative
   * to, and where issue #51's renderer samples the ground elevation that
   * turns "how high above the *building's own base*" into "how high above
   * sea level". Exposed rather than re-derived, because it is already this
   * function's `anchor` and a second building-set lookup to recover it would
   * be paid for on every shadow, every frame.
   */
  anchorLon: number;
  anchorLat: number;
}

/**
 * Convex hull, Andrew's monotone chain.
 *
 * Computed in raw lon/lat. Over a single building — tens of metres — the
 * convergence of the meridians is far below the precision of the footprint, so
 * treating degrees as a plane is fine here. It would not be fine over a city,
 * which is why nothing else in this file works at that scale.
 */
export function convexHull(points: Ring): Ring {
  if (points.length <= 2) return points.slice();

  // Sort first, then drop duplicates — which are adjacent once sorted.
  //
  // This used to dedupe through a Map keyed on `${lon},${lat}`, which meant
  // formatting two floats into a string for every vertex of every building on
  // every frame of a scrub. Rings arrive closed, so at least one vertex in each
  // is always a duplicate and the key was always paid for. Sorting is needed
  // anyway; deduping on the way out of it is free.
  const unique: Ring = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let end = 0;
  for (let i = 1; i < unique.length; i++) {
    const previous = unique[end];
    const point = unique[i];
    if (point[0] === previous[0] && point[1] === previous[1]) continue;
    unique[++end] = point;
  }
  unique.length = end + 1;
  if (unique.length <= 2) return unique;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const half = (source: Ring): Ring => {
    const out: Ring = [];
    for (const p of source) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };

  return [...half(unique), ...half([...unique].reverse())];
}

/**
 * The shadow one building throws, as a closed ring.
 *
 * Returns null when there is nothing to draw: no sun, no height, or a footprint
 * too degenerate to have an outline.
 */
export function castShadow(
  footprint: Ring,
  heightM: number,
  sunAzimuth: number,
  sunAltitude: number,
  options: ShadowOptions = {},
): ShadowResult | null {
  const minAltitudeDeg = options.minAltitudeDeg ?? MIN_ALTITUDE_DEG;
  const maxLengthM = options.maxLengthM ?? maxShadowLength(sunAltitude);
  if (!(heightM > 0)) return null;
  if (!(sunAltitude > minAltitudeDeg)) return null;
  if (footprint.length < 3) return null;

  const ratio = shadowLengthRatio(sunAltitude);
  if (!Number.isFinite(ratio)) return null;

  const full = heightM * ratio;
  const lengthM = Math.min(full, maxLengthM);
  const bearing = shadowBearing(sunAzimuth);

  // Every vertex of a footprint slides the same way by the same amount, so the
  // offset is one vector rather than one geodesic solve per vertex. Solved once,
  // with the same `destination` the rest of the file trusts, then added.
  //
  // The approximation is that a displacement measured at one corner is applied
  // across the whole footprint. Measured rather than assumed: over a 60 m
  // footprint — larger than most buildings — with a 1.5 km shadow at 70° north,
  // the worst vertex lands 3.9 cm from where a per-vertex geodesic solve would
  // put it, and nearer the equator it is under a centimetre. Set against a
  // height usually inferred from a storey count, that is nothing. What it buys
  // is the difference between five geodesic solves per building and one, which
  // is what lets a whole city recast inside a frame while the slider is moving.
  const anchor = footprint[0];
  const moved = destination({ lat: anchor[1], lon: anchor[0] } as LatLon, bearing, lengthM);
  const dLon = moved.lon - anchor[0];
  const dLat = moved.lat - anchor[1];

  // Only the hull's own vertices need shifting: an interior point of the
  // footprint is an interior point of the translate too, and can never appear
  // on the outline of the union.
  const base = options.hull ?? convexHull(footprint);
  const shifted: Ring = base.map(([lon, lat]) => [lon + dLon, lat + dLat]);

  const hull = convexHull([...base, ...shifted]);
  if (hull.length < 3) return null;

  // Close the ring — GeoJSON polygons require the first and last to match.
  const ring: Ring = [...hull, hull[0]];

  // The shadow's ceiling, from position alone.
  //
  // Measured along the shadow's own bearing, in local metres: `s` is how far
  // down-sun a vertex lies. The ceiling holds at the full height across the
  // footprint and then falls at tan(altitude) per metre from the footprint's
  // *down-sun extreme* — so on its own footprint it equals the height exactly,
  // which is how a building avoids being painted with its own shadow.
  //
  // Taking the extreme rather than the true silhouette overstates the ceiling
  // slightly for the parts of the shadow thrown by a nearer edge, which errs
  // towards drawing a shadow rather than withholding one. That is the same
  // direction the convex hull already errs in, and the honest one: this model
  // should not delete a shadow it is not sure is blocked.
  const rad = Math.PI / 180;
  const mPerLat = 111_320;
  const mPerLon = 111_320 * Math.max(0.05, Math.cos(anchor[1] * rad));
  const east = Math.sin(bearing * rad);
  const north = Math.cos(bearing * rad);
  const along = (lon: number, lat: number) =>
    (lon - anchor[0]) * mPerLon * east + (lat - anchor[1]) * mPerLat * north;

  // Over the hull rather than the whole footprint. `along` is linear in
  // (lon, lat), and a linear function over a finite point set attains its
  // maximum at a vertex of that set's convex hull — so this is the same number
  // for a fraction of the reads.
  let baseMax = -Infinity;
  for (const [lon, lat] of base) baseMax = Math.max(baseMax, along(lon, lat));

  const perMetre = 1 / ratio; // tan(altitude)
  const ceilings = ring.map(([lon, lat]) => {
    const drop = Math.max(0, along(lon, lat) - baseMax) * perMetre;
    return Math.min(heightM, Math.max(0, heightM - drop));
  });

  return {
    ring,
    ceilings,
    lengthM,
    clipped: full > maxLengthM,
    anchorLon: anchor[0],
    anchorLat: anchor[1],
  };
}

/**
 * A square footprint centred on a point — the base of the monolith.
 *
 * The monolith is a thing you put down on the map to watch: a slab of known
 * height, in a spot of your choosing, casting a real shadow computed the same
 * way every building's is. It exists because most of what a photographer wants
 * to know is not about a building that happens to be in the vector tiles. It is
 * "if I stand *here*, where does my shadow fall", or "how tall would that wall
 * have to be to shade this doorway at four o'clock". Nothing in OpenStreetMap
 * answers that; a slab you can drag does.
 *
 * It is also the one shadow on the map drawn from a height that is *known*
 * rather than inferred, because you typed it. Everything else here is honest
 * about guessing; this one has nothing to guess.
 *
 * Corners are placed by geodesic bearing rather than by adding degrees, so the
 * square is square at 70°N as well as at the equator.
 */
export function squareFootprint(centre: LatLon, sizeM: number, bearing = 0): Ring {
  if (!(sizeM > 0)) throw new RangeError('sizeM must be greater than zero');
  // Half the diagonal: the corners of a square of side `sizeM` sit at 45° to its
  // faces, √2/2 × size from the middle.
  const reach = (sizeM * Math.SQRT2) / 2;
  const ring: Ring = [];
  for (const corner of [45, 135, 225, 315]) {
    const point = destination(centre, bearing + corner, reach);
    ring.push([point.lon, point.lat]);
  }
  ring.push(ring[0]);
  return ring;
}

/** Pull a usable height out of whatever the vector tile happens to carry. */
export function buildingHeight(properties: Record<string, unknown> | null | undefined): number {
  if (!properties) return 0;
  const render = Number(properties.render_height);
  if (Number.isFinite(render) && render > 0) return render;
  const height = Number(properties.height);
  if (Number.isFinite(height) && height > 0) return height;
  const levels = Number(properties.building_levels ?? properties['building:levels']);
  // 3.2m a storey is the usual planning rule of thumb. A guess, and flagged as
  // one by `heightIsEstimated` so the drawing can be honest about it.
  if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  return 0;
}

/** True when the height came from a storey count rather than a measurement. */
export function heightIsEstimated(properties: Record<string, unknown> | null | undefined): boolean {
  if (!properties) return true;
  const render = Number(properties.render_height);
  if (Number.isFinite(render) && render > 0) return false;
  const height = Number(properties.height);
  if (Number.isFinite(height) && height > 0) return false;
  return true;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Does this footprint touch the box at all?
 *
 * Needed because OpenMapTiles merges buildings into enormous MultiPolygons —
 * a single feature over Shibuya carries nearly twelve thousand sub-polygons,
 * spanning whole tiles. Casting all of them costs a fifth of a second and draws
 * tens of thousands of shapes nobody can see. A bounding-box test first turns
 * that into the few hundred that are actually on screen.
 */
export function ringIntersects(ring: Ring, bounds: Bounds): boolean {
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
  return !(east < bounds.west || west > bounds.east || north < bounds.south || south > bounds.north);
}

/**
 * Eight bytes of scratch, so hashing a float allocates nothing.
 *
 * Module-level and reused: this runs once per building per gather, and a
 * `DataView` per call would be several thousand short-lived objects on every
 * burst of tiles.
 */
const floatBits = new DataView(new ArrayBuffer(8));

/** Mix one double into a running 32-bit hash. */
function hashFloat(seed: number, value: number): number {
  floatBits.setFloat64(0, value);
  let h = seed ^ floatBits.getInt32(0);
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= floatBits.getInt32(4);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * A fingerprint of a gathered set of footprints.
 *
 * The page re-gathers buildings on every burst of tiles, which at a city zoom
 * is dozens of times a second, and almost every one of those gathers returns
 * exactly what the last did. Comparing counts is not enough to notice that —
 * a pan that brings one building in as another leaves keeps the count — and
 * the cost of getting it wrong is either a stale skyline or a needless recast
 * of four thousand shadows.
 *
 * Order-independent, because `querySourceFeatures` walks whichever tiles it
 * happens to hold and does not promise an order. That is what the sum is for:
 * addition does not care what order it is done in, where a running hash would
 * make the same set fingerprint differently depending on tile arrival.
 *
 * Hashed on the first vertex and the height, which is what the caller's own
 * de-duplication already treats as a building's identity.
 */
export function buildingSetSignature(
  buildings: ReadonlyArray<{ ring: Ring; height: number }>,
): string {
  let total = 0;
  for (const building of buildings) {
    const first = building.ring[0];
    if (!first) continue;
    let h = hashFloat(0x9e3779b9, first[0]);
    h = hashFloat(h, first[1]);
    h = hashFloat(h, building.height);
    total = (total + h) >>> 0;
  }
  // The count is carried separately so that a set and a copy of it with one
  // building duplicated cannot collide, however the sum lands.
  return `${buildings.length}:${total.toString(36)}`;
}

/** Grow a box by a distance in metres, roughly. Used to catch shadows that fall in from off-screen. */
export function padBounds(bounds: Bounds, metres: number): Bounds {
  const lat = (bounds.north + bounds.south) / 2;
  const dLat = metres / 111_320;
  const dLon = metres / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return {
    west: bounds.west - dLon,
    south: bounds.south - dLat,
    east: bounds.east + dLon,
    north: bounds.north + dLat,
  };
}

export interface ShadowTally {
  /** How many buildings actually cast something. */
  cast: number;
  /** How many were skipped for want of a height. */
  skippedNoHeight: number;
  /** How many had their shadow cut short by the length cap. */
  clipped: number;
  /** The longest shadow drawn, metres. */
  longestM: number;
  /** How many buildings were dropped to stay inside `limit`. */
  omitted: number;
}

export interface ShadowFeatureCollection extends ShadowTally {
  collection: GeoJSON.FeatureCollection;
}

export interface ShadowPrisms extends ShadowTally {
  prisms: Array<ShadowResult & { estimated: boolean }>;
}

/**
 * Cast every building in a set, keeping each shadow as the volume it is.
 *
 * Deliberately not unioned *here*. Unioning several hundred polygons every time
 * the slider moves costs far more than letting them overlap, and the overlap is
 * not a modelling question anyway — it is a drawing one. A point the sun cannot
 * reach is equally unlit whether one building blocks it or three, so the shapes
 * are handed on whole and the renderer is left to take the darkest rather than
 * the sum. `shadow-layer.ts` does that on the GPU, for nothing.
 */
export function castPrisms(
  buildings: Array<{ ring: Ring; height: number; estimated?: boolean; hull?: Ring }>,
  sunAzimuth: number,
  sunAltitude: number,
  options: ShadowOptions & { limit?: number } = {},
): ShadowPrisms {
  const prisms: Array<ShadowResult & { estimated: boolean }> = [];
  let skippedNoHeight = 0;
  let clipped = 0;
  let longestM = 0;
  let omitted = 0;

  // Tallest first, then cut. If there is more in view than can be drawn
  // smoothly, the buildings worth keeping are the ones throwing the long
  // shadows — losing a row of sheds matters far less than losing a tower.
  let working = buildings;
  const limit = options.limit;
  if (limit != null && buildings.length > limit) {
    working = [...buildings].sort((a, b) => b.height - a.height).slice(0, limit);
    omitted = buildings.length - limit;
  }

  for (const building of working) {
    if (!(building.height > 0)) {
      skippedNoHeight++;
      continue;
    }
    const shadow = castShadow(building.ring, building.height, sunAzimuth, sunAltitude, {
      ...options,
      hull: building.hull,
    });
    if (!shadow) continue;
    if (shadow.clipped) clipped++;
    if (shadow.lengthM > longestM) longestM = shadow.lengthM;
    prisms.push({ ...shadow, estimated: Boolean(building.estimated) });
  }

  return { prisms, cast: prisms.length, skippedNoHeight, clipped, longestM, omitted };
}

/**
 * The same cast, flattened to a FeatureCollection for a plain fill layer.
 *
 * Kept for the fallback path: a fill layer blends every feature separately, so
 * overlapping shadows there really do pool darker than either of them, and
 * nothing in the style can prevent it. It is the older, lesser picture, used
 * only where the custom layer cannot run.
 */
export function castShadows(
  buildings: Array<{ ring: Ring; height: number; estimated?: boolean }>,
  sunAzimuth: number,
  sunAltitude: number,
  options: ShadowOptions & { limit?: number } = {},
): ShadowFeatureCollection {
  const result = castPrisms(buildings, sunAzimuth, sunAltitude, options);
  const features: GeoJSON.Feature[] = result.prisms.map((shadow) => ({
    type: 'Feature',
    // `lengthM` travels with the shape so the style can fade the long throws:
    // the far end of a 1km shadow is the part this model is least sure it
    // reaches, and it should not be painted as confidently as the dark strip
    // at the foot of the wall, which is certain.
    properties: { estimated: shadow.estimated, lengthM: Math.round(shadow.lengthM) },
    geometry: { type: 'Polygon', coordinates: [shadow.ring] },
  }));

  return {
    collection: { type: 'FeatureCollection', features },
    cast: result.cast,
    skippedNoHeight: result.skippedNoHeight,
    clipped: result.clipped,
    longestM: result.longestM,
    omitted: result.omitted,
  };
}
