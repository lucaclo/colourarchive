import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import tzLookup from 'tz-lookup';
import { SCOUT_GEOCODE_DIR } from '../paths';
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
  /** OSM's own classification: city, suburb, peak, viewpoint… */
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

const cacheKey = (query: string, limit: number) =>
  createHash('sha1')
    .update(`v${CACHE_VERSION} ${normalise(query)} ${limit}`)
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
    kind: raw.addresstype || raw.type || raw.category || 'place',
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

  const key = cacheKey(trimmed, bounded);
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
    return body.map(toPlace).filter((p): p is Place => p !== null);
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
export async function reverseGeocode(latitude: number, longitude: number): Promise<Place> {
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
  const key = cacheKey(`reverse ${lat.toFixed(5)} ${lon.toFixed(5)}`, 1);
  const cached = await readCache(key);
  if (cached?.length) return cached[0];

  const url = new URL(REVERSE_ENDPOINT);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  // Zoom 16 is roughly "this street or this building" — the grain a person
  // dragging a pin across a city means.
  url.searchParams.set('zoom', '16');

  try {
    const place = await serialise(async () => {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
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
