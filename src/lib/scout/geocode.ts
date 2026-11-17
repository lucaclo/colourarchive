import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import tzLookup from 'tz-lookup';
import { SCOUT_GEOCODE_DIR } from '../paths';
import { sweepStaleCache } from './cache-sweep';
import { wrapLongitude, clampLatitude } from './geo';
import { coordinatePlace, reverseParams, searchLimit, searchParams, toPlace, toPlaces, type NominatimResult, type Place } from './nominatim';

// Parsing lives in nominatim.ts so the published Scout reads answers the same way.
export { dedupePlaces, placeKind, type Place } from './nominatim';

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

/* ── Parsing (see nominatim.ts) ──────────────────────────────────────────── */

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

/* ── Search ────────────────────────────────────────────────────────────────── */

export class GeocodeError extends Error {}

/**
 * Look up a place by name. Cached answers return immediately; anything else
 * waits its turn in the rate-limited queue.
 */
export async function searchPlaces(query: string, limit = 6): Promise<Place[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const bounded = searchLimit(limit);

  const key = cacheKey(trimmed, bounded, SEARCH_CACHE_VERSION);
  const cached = await readCache(key);
  if (cached) return cached;

  const url = new URL(`${ENDPOINT}?${searchParams(trimmed, bounded)}`);

  const places = await serialise(async () => {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new GeocodeError(`Nominatim answered ${response.status}.`);
    }
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new GeocodeError('Nominatim sent something unexpected.');
    return toPlaces(body, safeTimeZone);
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

  const fallback: Place = coordinatePlace(lat, lon, safeTimeZone);

  // Five decimal places is about a metre — finer than the pin can be placed,
  // and enough that dragging back to the same spot is a cache hit.
  const key = cacheKey(`reverse ${lat.toFixed(5)} ${lon.toFixed(5)}${zoom === 16 ? '' : ` z${zoom} en`}`, 1);
  const cached = await readCache(key);
  if (cached?.length) return cached[0];

  // Zoom 16 is roughly "this street or this building" — the grain a person
  // dragging a pin across a city means.
  const url = new URL(`${REVERSE_ENDPOINT}?${reverseParams(lat, lon, zoom)}`);

  try {
    const place = await serialise(async () => {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(zoom === 16 ? {} : { 'Accept-Language': 'en' }) },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new GeocodeError(`Nominatim answered ${response.status}.`);
      return toPlace((await response.json()) as NominatimResult, safeTimeZone);
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
