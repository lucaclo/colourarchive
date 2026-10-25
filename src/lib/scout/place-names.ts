/**
 * What to call a photo spot.
 *
 * A photograph's title is the photographer's caption — "Morning", "Untitled
 * #4", "the bench again" — not the name of a place, and a list of eight spots
 * captioned like that cannot be told apart. The map already holds the names
 * people use for places, in the vector tiles that are loaded anyway, so a spot
 * is named after the landmark it stands by or the park it stands in, and only
 * falls back to a caption when the map has nothing to say.
 *
 * Landmarks only. A café or a bank is the nearest named thing on most city
 * corners and says nothing about why anybody photographed there.
 */

import { distance, type LatLon } from './geo';
import { pointInRing } from './trees';
import type { Ring } from './shadows';

/** One named thing from the map, as read off the loaded tiles. */
export type NamedPlace =
  | { kind: 'poi'; name: string; at: LatLon; class: string; subclass?: string }
  | { kind: 'park'; name: string; rings: Ring[] };

/** OpenMapTiles `poi` classes a photographer would stand by on purpose. */
const LANDMARK_CLASSES = new Set([
  'attraction',
  'monument',
  'museum',
  'castle',
  'art_gallery',
  'place_of_worship',
  'theatre',
  'park',
  'garden',
  'zoo',
  'stadium',
  'railway',
  'harbor',
  'ferry_terminal',
  'town_hall',
  'college',
  'library',
]);

/** Subclasses that are landmarks whatever class they were filed under. */
const LANDMARK_SUBCLASSES = new Set(['viewpoint', 'artwork', 'fountain', 'memorial', 'bridge', 'lighthouse']);

export const isLandmark = (cls: string, subclass?: string): boolean =>
  LANDMARK_CLASSES.has(cls) || (subclass != null && LANDMARK_SUBCLASSES.has(subclass));

/** How far a landmark can be from a spot and still be what it is "at". */
export const NAME_RADIUS_M = 80;

/**
 * The name for a spot at `at`, or null when the map has none worth using.
 *
 * The nearest landmark within `NAME_RADIUS_M` wins; failing that, the park the
 * spot stands inside. Closer beats bigger: a fountain twenty metres away is
 * what a spot inside a large park is actually about.
 */
export function placeNameFor(at: LatLon, places: NamedPlace[], maxM = NAME_RADIUS_M): string | null {
  let best: { name: string; d: number } | null = null;
  for (const place of places) {
    if (place.kind !== 'poi' || !place.name || !isLandmark(place.class, place.subclass)) continue;
    const d = distance(at, place.at);
    if (d <= maxM && (!best || d < best.d)) best = { name: place.name, d };
  }
  if (best) return best.name;
  for (const place of places) {
    if (place.kind !== 'park' || !place.name) continue;
    // Outer ring in, any hole out: a spot in a pond in the park is not in the park.
    const [outer, ...holes] = place.rings;
    if (outer && pointInRing(outer, at.lon, at.lat) && !holes.some((h) => pointInRing(h, at.lon, at.lat))) {
      return place.name;
    }
  }
  return null;
}
