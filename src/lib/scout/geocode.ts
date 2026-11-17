import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import tzLookup from 'tz-lookup';
import { SCOUT_GEOCODE_DIR } from '../paths';
import { sweepStaleCache } from './cache-sweep';
import { wrapLongitude, clampLatitude } from './geo';

/**
 * Turning a typed place into coordinates, via Nominatim.
 *
 * Server-side only, and deliberately so. Nominatim is a free service run on
 * donated hardware with a published usage policy: one request a second, a
 * User-Agent that says who you are, and results cached rather than re-fetched.
 * Calling it straight from the browser would break all three — every visitor's
 * keystroke would become a request from an anonymous origin. Routing it through
 * one server-side client means the rate limit is real, the identification is
 * honest, and a place you have already looked up costs nothing to look up again.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const REVERSE_ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';

/** Nominatim requires an identifying User-Agent. An anonymous one gets blocked. */
const USER_AGENT = 'ColourArchiveScout/0.1 (personal photography scouting tool)';

/** Their policy is one request per second; a little margin on top of it. */
const MIN_INTERVAL_MS = 1100;

const REQUEST_TIMEOUT_MS = 8000;

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
   * IANA zone for the coordinates — "Asia/Tokyo", not an offset.
   *
   * Resolved here rather than in the browser for two reasons. The lookup table
   * is 172KB of polygon data that has no business in the client bundle, and a
   * *name* rather than an offset is what lets `Intl` get the DST right: scouting
   * Tokyo in July from London is exactly the case where an offset frozen at
   * lookup time would quietly drift an hour off by autumn.
   */
  timeZone: string;
  /** [west, south, east, north] where Nominatim offers one. */
  bounds?: [number, number, number, number];
}

/* ── Rate limiting ─────────────────────────────────────────────────────────
   A single promise chain, so concurrent callers queue behind each other rather
   than all firing at once. Two people typing at the same time is not a case
   worth being clever about; it is a case worth not being rude about. */

let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function serialise<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a link rejects, or one failed lookup would
  // wedge every lookup after it.
  queue = run.catch(() => undefined);
  return run;
}

/* ── Cache ─────────────────────────────────────────────────────────────────── */

/** Bumped when the cached shape changes, so stale entries are ignored rather
 *  than served without their newer fields. */
const CACHE_VERSION = 2;
/** Searches only: from 3, each place is listed once with a plain word for what
 *  it is. Reverse lookups stay on 2, since they only read `kind` for 'point'
 *  and re-asking for every placed photo would cost a second each. */
const SEARCH_CACHE_VERSION = 3;

// Places don't move, so an entry is never stale by content — but one bumping
// CACHE_VERSION orphans every file under the old hash forever, and a query
// typed once and never again just sits on disk. Half a year unused is a safe
// line for "let it go and re-fetch if it's ever asked for again."
const GEOCODE_MAX_AGE_MS = 180 * 24 * 60 * 60_000;
sweepStaleCache(SCOUT_GEOCODE_DIR, GEOCODE_MAX_AGE_MS).catch(() => {});

const cacheKey = (query: string, limit: number, version = CACHE_VERSION) =>
  createHash('sha1')
    .update(`v${version} ${normalise(query)} ${limit}`)
    .digest('hex')
    .slice(0, 20);

const normalise = (query: string) => query.trim().replace(/\s+/g, ' ').toLowerCase();

async function readCache(key: string): Promise<Place[] | null> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_GEOCODE_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { places?: Place[] };
    return Array.isArray(parsed.places) ? parsed.places : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, query: string, places: Place[]): Promise<void> {
  try {
    await fs.mkdir(SCOUT_GEOCODE_DIR, { recursive: true });
    await fs.writeFile(
      path.join(SCOUT_GEOCODE_DIR, `${key}.json`),
      JSON.stringify({ query, fetchedAt: new Date().toISOString(), places }, null, 2),
    );
  } catch (err) {
    // A cache that cannot be written is a slower search, not a broken one.
    console.warn('[scout] could not cache geocode result', err);
  }
}

/* ── Parsing ───────────────────────────────────────────────────────────────── */

/**
 * IANA zone for a coordinate. Falls back to UTC rather than throwing: a place
 * whose clock we cannot name is still a place worth putting on the map, and the
 * sun geometry — which is what Scout is actually for — does not depend on it.
 */
function safeTimeZone(lat: number, lon: number): string {
  try {
    return tzLookup(lat, lon);
  } catch {
    return 'UTC';
  }
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  addresstype?: string;
  boundingbox?: [string, string, string, string];
}

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

function toPlace(raw: NominatimResult): Place | null {
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
    // tz-lookup covers the whole globe including ocean, but a thrown lookup
    // should cost the time display, not the whole search result.
    timeZone: safeTimeZone(safeLat, safeLon),
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

/* ── Search ────────────────────────────────────────────────────────────────── */

export class GeocodeError extends Error {}

/**
 * Look up a place by name. Cached answers return immediately; anything else
 * waits its turn in the rate-limited queue.
 */
export async function searchPlaces(query: string, limit = 6): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const bounded = Math.min(10, Math.max(1, Math.floor(limit)));

  const key = cacheKey(trimmed, bounded, SEARCH_CACHE_VERSION);
  const cached = await readCache(key);
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', String(bounded));
  url.searchParams.set('addressdetails', '0');

  const places = await serialise(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new GeocodeError(`Nominatim answered ${response.status}.`);
    }
    const body = (await response.json()) as NominatimResult[];
    if (!Array.isArray(body)) throw new GeocodeError('Nominatim sent something unexpected.');
    return dedupePlaces(body.map(toPlace).filter((p): p is Place => p !== null));
  });

  await writeCache(key, trimmed, places);
  return places;
}

/**
 * The other direction: a coordinate to a name, for when the pin is dragged.
 *
 * Dragging is how you scout the *place next to* the place you searched for — the
 * bridge rather than the town, the north side of the square rather than its
 * centre — and it is Scout's only way to reach somewhere that has no name to
 * type. That keeps decision 5 intact: still no GPS, still nothing but a
 * coordinate you chose deliberately.
 *
 * A failed reverse lookup is *not* an error here. The coordinate is the thing
 * that matters and it is already known; the name is a courtesy. So this falls
 * back to the coordinate written out rather than throwing, and the sun geometry
 * never waits on Nominatim.
 */
/** `zoom` is Nominatim's grain: 16 (the default) names the street or building
 *  a dragged pin means; 10 names the town, for "taken near …" and a colophon. */
export async function reverseGeocode(latitude: number, longitude: number, zoom = 16): Promise<Place> {
  const lat = clampLatitude(latitude);
  const lon = wrapLongitude(longitude);

  const format = (value: number, positive: string, negative: string) =>
    `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
  const fallback: Place = {
    name: `${format(lat, 'N', 'S')} ${format(lon, 'E', 'W')}`,
    detail: '',
    lat,
    lon,
    kind: 'point',
    timeZone: safeTimeZone(lat, lon),
  };

  // Five decimal places is about a metre — finer than the pin can be placed,
  // and enough that dragging back to the same spot is a cache hit.
  const key = cacheKey(`reverse ${lat.toFixed(5)} ${lon.toFixed(5)}${zoom === 16 ? '' : ` z${zoom} en`}`, 1);
  const cached = await readCache(key);
  if (cached?.length) return cached[0];

  const url = new URL(REVERSE_ENDPOINT);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  // Zoom 16 is roughly "this street or this building" — the grain a person
  // dragging a pin across a city means.
  url.searchParams.set('zoom', String(zoom));

  try {
    const place = await serialise(async () => {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(zoom === 16 ? {} : { 'Accept-Language': 'en' }) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new GeocodeError(`Nominatim answered ${response.status}.`);
      return toPlace((await response.json()) as NominatimResult);
    });
    // Nominatim's own coordinates are the centre of whatever it matched, which
    // can be the middle of a whole suburb. The point that was asked about is the
    // point that was meant, so the name is borrowed and the coordinate is kept.
    const resolved: Place = place
      ? { ...place, lat, lon, timeZone: place.timeZone || fallback.timeZone }
      : fallback;
    await writeCache(key, `reverse ${lat},${lon}`, [resolved]);
    return resolved;
  } catch (err) {
    console.warn('[scout] reverse geocode failed, using the coordinate', err);
    return fallback;
  }
}
