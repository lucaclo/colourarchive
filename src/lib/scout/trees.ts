/**
 * Trees, for the map to stand up and cast shadows from.
 *
 * Two sources, kept apart on purpose. **Mapped** trees come from OpenStreetMap
 * (`natural=tree` nodes, via Overpass): their position is a fact someone
 * recorded, and so is their height when it is tagged. **Estimated** trees are
 * scattered inside parks and woods, where the vector tiles know there is
 * greenery but nobody has mapped the individual trees — which is most parks on
 * earth outside a handful of cities.
 *
 * The estimated ones are a picture, not a claim. They are drawn, and their
 * shadows are drawn lighter, but they never join the building set the
 * skyline, the per-spot light windows or the hotspot ranking are computed
 * from — the same rule as everywhere else here: a guess may look like
 * something, but it may not be reported as something.
 *
 * Pure: geometry and parsing only. The fetching and drawing live in the view.
 */

import { destination, distance, type LatLon } from './geo';
import type { Ring } from './shadows';

export interface Tree {
  lon: number;
  lat: number;
  /** Top of the crown, metres above the ground. */
  heightM: number;
  /** Crown diameter, metres. */
  crownM: number;
  /** Placed by scatter rather than mapped. */
  estimated: boolean;
  /** The height came from a tag rather than a default. */
  heightKnown: boolean;
}

/** What an untagged tree is drawn as: a mid-sized street or park tree. */
export const DEFAULT_TREE_HEIGHT_M = 11;
export const DEFAULT_CROWN_M = 7;

const RAD = Math.PI / 180;
const METRES = /^\s*(\d+(?:\.\d+)?)\s*(m|metres|meters)?\s*$/i;

/** A metres value from an OSM tag — "12", "12 m", "12.5m" — or null. */
function metresTag(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = value.match(METRES);
  if (!match) return null;
  const n = Number(match[1]);
  return n > 0 && n < 130 ? n : null;
}

/**
 * Parse an Overpass JSON answer into trees. Anything that is not a node with a
 * position is skipped; heights and crowns come from `height` / `est_height` and
 * `diameter_crown` when tagged, and from the defaults when not.
 */
export function parseOverpassTrees(json: unknown): Tree[] {
  const elements = (json as { elements?: unknown[] } | null)?.elements;
  if (!Array.isArray(elements)) return [];
  const trees: Tree[] = [];
  for (const raw of elements) {
    const el = raw as { type?: string; lat?: number; lon?: number; tags?: Record<string, string> };
    if (el.type !== 'node' || typeof el.lat !== 'number' || typeof el.lon !== 'number') continue;
    const tags = el.tags ?? {};
    const tagged = metresTag(tags.height) ?? metresTag(tags.est_height);
    const crown = metresTag(tags.diameter_crown);
    const heightM = tagged ?? DEFAULT_TREE_HEIGHT_M;
    trees.push({
      lon: el.lon,
      lat: el.lat,
      heightM,
      // A crown tagged wider than the tree is tall is a typo far more often
      // than it is a baobab.
      crownM: Math.min(crown ?? Math.max(3, Math.min(DEFAULT_CROWN_M, heightM * 0.65)), heightM * 1.4),
      estimated: false,
      heightKnown: tagged != null,
    });
  }
  return trees;
}

/** The Overpass QL asking for every mapped tree in a box. */
export function overpassTreeQuery(box: { west: number; south: number; east: number; north: number }): string {
  const f = (n: number) => n.toFixed(5);
  return `[out:json][timeout:20];node["natural"="tree"](${f(box.south)},${f(box.west)},${f(box.north)},${f(box.east)});out;`;
}

/** Even-odd point-in-polygon on the outer ring. */
export function pointInRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A hash to [0, 1), stable across runs — the scatter must not shimmer. */
function hash(a: number, b: number, salt: number): number {
  let h = (Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface ScatterArea {
  ring: Ring;
  /** 'wood' is dense canopy; 'park' is open lawn with trees in it. */
  kind: 'wood' | 'park';
}

/** Metres between estimated trees, by cover. */
export const SCATTER_SPACING_M = { wood: 9, park: 22 } as const;

/**
 * Estimated trees inside parks and woods.
 *
 * A jittered grid anchored to the *world* — cells are fixed lat/lon squares,
 * not squares relative to the viewport — so the same park grows the same trees
 * however it is panned into view, and a tree does not jump when a tile loads.
 * Each cell may hold one tree, kept with a probability that thins parks into
 * clumps rather than an orchard.
 *
 * A mapped tree nearby suppresses the estimate, and an area already holding
 * enough mapped trees is left to them entirely: where someone has surveyed a
 * park, the survey wins.
 */
export function scatterTrees(
  areas: ScatterArea[],
  box: { west: number; south: number; east: number; north: number },
  mapped: Tree[],
  limit = 2500,
  /** Rings no estimate may stand in — water, mostly: a park's grass polygon
   *  routinely runs straight across the lake in the middle of it. */
  exclude: Ring[] = [],
): Tree[] {
  const out: Tree[] = [];
  const mPerDegLat = 111_320;

  for (const area of areas) {
    if (out.length >= limit) break;
    const ring = area.ring;
    if (!ring || ring.length < 4) continue;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    // The grid's scale comes from the area's own latitude, rounded to a
    // degree — never the viewport's, or panning would re-seed every tree.
    const mPerDegLon = 111_320 * Math.cos(Math.round((s + n) / 2) * RAD);
    w = Math.max(w, box.west);
    e = Math.min(e, box.east);
    s = Math.max(s, box.south);
    n = Math.min(n, box.north);
    if (w >= e || s >= n) continue;

    const inside = mapped.filter(
      (t) => t.lon >= w && t.lon <= e && t.lat >= s && t.lat <= n && pointInRing(ring, t.lon, t.lat),
    );
    const areaM2 = (e - w) * mPerDegLon * (n - s) * mPerDegLat;
    const spacing = SCATTER_SPACING_M[area.kind];
    // Surveyed: at least a quarter of the canopy this cover would carry.
    if (inside.length >= (areaM2 / (spacing * spacing)) * 0.25) continue;

    const cellLon = spacing / mPerDegLon;
    const cellLat = spacing / mPerDegLat;
    const keep = area.kind === 'wood' ? 0.85 : 0.55;
    const salt = area.kind === 'wood' ? 7 : 3;
    for (let i = Math.floor(w / cellLon); i * cellLon < e && out.length < limit; i++) {
      for (let j = Math.floor(s / cellLat); j * cellLat < n && out.length < limit; j++) {
        if (hash(i, j, salt) > keep) continue;
        const lon = (i + 0.15 + 0.7 * hash(i, j, salt + 1)) * cellLon;
        const lat = (j + 0.15 + 0.7 * hash(i, j, salt + 2)) * cellLat;
        if (lon < w || lon > e || lat < s || lat > n) continue;
        if (!pointInRing(ring, lon, lat)) continue;
        if (exclude.some((hole) => pointInRing(hole, lon, lat))) continue;
        const here: LatLon = { lat, lon };
        const size = hash(i, j, salt + 3);
        const heightM = area.kind === 'wood' ? 12 + size * 10 : 8 + size * 9;
        const crownM = Math.max(3.5, heightM * (0.5 + 0.2 * hash(i, j, salt + 4)));
        if (inside.some((t) => distance(here, t) < (crownM + t.crownM) / 2)) continue;
        out.push({ lon, lat, heightM, crownM, estimated: true, heightKnown: false });
      }
    }
  }
  return out;
}

/**
 * A regular polygon on the ground, closed, `sides` corners round a centre.
 * Rotated per tree so a stand of identical octagons does not line up like
 * bolts on a plate.
 */
export function crownRing(tree: { lon: number; lat: number }, radiusM: number, sides = 8, turnDeg = 0): Ring {
  const ring: Ring = [];
  for (let k = 0; k <= sides; k++) {
    const p = destination({ lat: tree.lat, lon: tree.lon }, turnDeg + (360 / sides) * (k % sides), radiusM);
    ring.push([p.lon, p.lat]);
  }
  return ring;
}

/**
 * The extruded shapes a tree is drawn from: a trunk, then two tiers of crown
 * — a wide lower mass and a narrower top — which is enough, at map scale, to
 * read as a rounded tree rather than a green column.
 */
export function treeParts(tree: Tree): Array<{ ring: Ring; base: number; top: number; part: 'trunk' | 'crown' }> {
  const h = tree.heightM;
  const r = tree.crownM / 2;
  const trunkTop = Math.max(1.5, h * 0.3);
  const shoulder = trunkTop + (h - trunkTop) * 0.62;
  const turn = (((tree.lon * 1e5 + tree.lat * 1e5) % 45) + 45) % 45;
  return [
    { ring: crownRing(tree, Math.max(0.25, r * 0.12), 5, turn), base: 0, top: trunkTop + 0.5, part: 'trunk' },
    { ring: crownRing(tree, r, 8, turn), base: trunkTop, top: shoulder, part: 'crown' },
    { ring: crownRing(tree, r * 0.66, 8, turn + 22.5), base: shoulder, top: h, part: 'crown' },
  ];
}
