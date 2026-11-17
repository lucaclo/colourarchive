/**
 * Nominatim's answers, read into Scout's `Place`. Pure, with no Node imports,
 * so the Mac's server (geocode.ts) and the published Scout in the browser
 * (view/scout-api.ts) read them the same way.
 *
 * The time zone is passed in: the server has tz-lookup to hand, and the
 * browser loads it only when the published Scout first searches.
 */
import { wrapLongitude, clampLatitude } from './geo';

export interface Place {
  /** The bit worth reading first — "Shibuya Crossing", "Reykjavík". */
  name: string;
  /** The rest of the address, for telling two Springfields apart. */
  detail: string;
  lat: number;
  lon: number;
  /** What it is, in a plain word (City, Pier, Street), or '' when OSM's class
   *  has none. `placeKind` makes it; 'point' marks a bare coordinate. */
  kind: string;
  /**
   * IANA zone for the coordinates — "Asia/Tokyo", not an offset. A *name*
   * rather than an offset is what lets `Intl` get the DST right: scouting
   * Tokyo in July from London is exactly the case where an offset frozen at
   * lookup time would quietly drift an hour off by autumn.
   */
  timeZone: string;
  /** [west, south, east, north] where Nominatim offers one. */
  bounds?: [number, number, number, number];
}

export interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
}

/** A coordinate to an IANA zone name; 'UTC' when it can't say. */
export type TimeZoneOf = (lat: number, lon: number) => string;

/** OSM classes whose own name isn't a word a person would use. */
const KIND_WORDS: Record<string, string> = {
  'man_made/pier': 'Pier',
  'man_made/lighthouse': 'Lighthouse',
  'man_made/tower': 'Tower',
  'man_made/bridge': 'Bridge',
  'man_made/breakwater': 'Breakwater',
  'man_made/windmill': 'Windmill',
  'tourism/attraction': 'Attraction',
  'tourism/viewpoint': 'Viewpoint',
  'tourism/museum': 'Museum',
  'tourism/gallery': 'Gallery',
  'tourism/artwork': 'Artwork',
  'tourism/hotel': 'Hotel',
};

/** Classes that already read as plain words, as Nominatim's `addresstype` or `type`. */
const PLAIN_KINDS = new Set([
  'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'borough',
  'county', 'state', 'region', 'province', 'country', 'municipality', 'island', 'islet',
  'peak', 'volcano', 'beach', 'bay', 'cliff', 'cape', 'glacier', 'valley', 'ridge',
  'park', 'garden', 'forest', 'wood', 'lake', 'river', 'waterfall', 'reservoir',
  'castle', 'monument', 'memorial', 'ruins', 'church', 'cathedral', 'station', 'square',
]);

/**
 * A plain word for what a search result is: Pier, not "man made". Streets are
 * Street, amenities say their type (Cafe, Library), anything else either
 * already reads as a word (City, Peak) or gets no label at all.
 */
export function placeKind(category = '', type = '', addresstype = ''): string {
  const word =
    KIND_WORDS[`${category}/${type}`] ??
    (category === 'highway' || addresstype === 'road' ? 'street' : null) ??
    (category === 'amenity' && type ? type : null) ??
    (PLAIN_KINDS.has(addresstype) ? addresstype : null) ??
    (PLAIN_KINDS.has(type) ? type : null) ??
    '';
  const spaced = word.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Each place once. Nominatim can return the same pier as a way and as a node:
 * same name, same address, a point apart. A later result is dropped when it
 * has an earlier one's name and sits within 1e-4° of it, or has its name and
 * address and falls inside its bounds. The first is kept.
 */
export function dedupePlaces(places: Place[]): Place[] {
  const kept: Place[] = [];
  const key = (s: string) => s.trim().toLowerCase();
  const NEAR = 1e-4 + 1e-9; // within 1e-4°, with room for float error
  for (const place of places) {
    const repeat = kept.some((k) => {
      if (key(k.name) !== key(place.name)) return false;
      if (Math.abs(k.lat - place.lat) <= NEAR && Math.abs(k.lon - place.lon) <= NEAR) return true;
      if (key(k.detail) !== key(place.detail) || !k.bounds) return false;
      const [west, south, east, north] = k.bounds;
      return place.lat >= south && place.lat <= north && place.lon >= west && place.lon <= east;
    });
    if (!repeat) kept.push(place);
  }
  return kept;
}

export function toPlace(raw: NominatimResult, timeZoneOf: TimeZoneOf): Place | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const full = (raw.display_name ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  const name = raw.name?.trim() || full[0] || 'Unnamed place';
  // Drop the leading element when it just repeats the name, then keep enough
  // context to disambiguate without printing the postcode and the country code.
  const rest = full[0] === name ? full.slice(1) : full;

  const safeLat = clampLatitude(lat);
  const safeLon = wrapLongitude(lon);

  const place: Place = {
    name,
    detail: rest.slice(0, 3).join(', '),
    lat: safeLat,
    lon: safeLon,
    kind: placeKind(raw.category, raw.type, raw.addresstype),
    timeZone: timeZoneOf(safeLat, safeLon),
  };

  // Nominatim's boundingbox is [south, north, west, east] — not the [w,s,e,n]
  // order everything else in this codebase uses. Reordered here, once.
  if (raw.boundingbox?.length === 4) {
    const [south, north, west, east] = raw.boundingbox.map(Number);
    if ([south, north, west, east].every(Number.isFinite)) {
      place.bounds = [west, south, east, north];
    }
  }
  return place;
}

/** A search's answer as places, each once; throws on anything but a list. */
export function toPlaces(body: unknown, timeZoneOf: TimeZoneOf): Place[] {
  if (!Array.isArray(body)) throw new Error('Nominatim sent something unexpected.');
  return dedupePlaces((body as NominatimResult[]).map((r) => toPlace(r, timeZoneOf)).filter((p): p is Place => p !== null));
}

/** Searches ask for at most ten, at least one. */
export const searchLimit = (limit: number) => Math.min(10, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 6)));

/** The query string of a search, the same from the Mac and from the browser. */
export function searchParams(query: string, limit: number): URLSearchParams {
  return new URLSearchParams({ q: query.trim(), format: 'jsonv2', limit: String(searchLimit(limit)), addressdetails: '0' });
}

/** Zoom 16 names the street or building a dragged pin means; 10 names the town. */
export function reverseParams(lat: number, lon: number, zoom = 16): URLSearchParams {
  return new URLSearchParams({ lat: String(lat), lon: String(lon), format: 'jsonv2', zoom: String(zoom) });
}

/** A bare coordinate, written out: the name when nothing better is known. */
export function coordinatePlace(latitude: number, longitude: number, timeZoneOf: TimeZoneOf): Place {
  const lat = clampLatitude(latitude);
  const lon = wrapLongitude(longitude);
  const format = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
  return { name: `${format(lat, 'N', 'S')} ${format(lon, 'E', 'W')}`, detail: '', lat, lon, kind: 'point', timeZone: timeZoneOf(lat, lon) };
}
