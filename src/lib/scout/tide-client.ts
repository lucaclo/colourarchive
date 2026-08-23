import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_TIDE_DAY_DIR, SCOUT_TIDE_STATION_DIR } from '../paths';
import type { LatLon } from './geo';
import {
  MAX_STATION_DISTANCE_KM,
  nearestStation,
  parseExtremes,
  parseStations,
  type TideExtreme,
  type TideStation,
} from './tide';

/**
 * Fetching WorldTides, server-side only — for the same reason the geocoder
 * and the forecast are: the key below must never reach a browser, and a
 * slider being scrubbed must not turn into a request storm against a metered,
 * paid API.
 *
 * ## The key
 *
 * Read straight from `process.env.WORLDTIDES_API_KEY`. This repo has no
 * dotenv convention to hook into — checked: the only other direct
 * `process.env` read is `SITE_URL`, and no keyed external API exists here yet
 * — so this matches that, and picking up a `.env` is left to however the
 * deployment already loads its environment (Astro's own `import.meta.env`
 * loading, a platform's env panel, or a shell export for local dev).
 *
 * A missing key is not an error thrown up through a `catch`. It is the exact
 * shape of gap Part 5's Flickr adapter was designed for and never got to
 * exercise (`SpotSource.needsKey`): a typed, honest "this needs a key this
 * deployment does not have" result that the caller can show on screen, rather
 * than a silent absence or a stack trace. See `TideStatus` below.
 *
 * ## The request/response shape — what is verified, what is not
 *
 * Endpoint and parameter names are taken from WorldTides' own docs
 * (`worldtides.info/apidocs`, fetched during development) and corroborated by
 * an unofficial Node client's published usage (`fvdm/nodejs-worldtides` on
 * GitHub) and a search-indexed example request. Verified this way:
 * `https://www.worldtides.info/api/v3` as the endpoint; `key`, `lat`, `lon`
 * as the identifying parameters; `date` (`YYYY-MM-DD`) and `days` for the
 * window; `extremes` as a bare flag requesting the high/low array, each entry
 * `{ dt, date, height, type }` with `dt` a Unix-seconds timestamp and `type`
 * the literal string `"High"`/`"Low"`; and `stations`/`stationDistance` (km)
 * as the bare flag and its radius parameter for a nearby-stations list, each
 * entry `{ id, name, lat, lon, timezone }`.
 *
 * Not verified against a live response, because no key was available to this
 * session and the docs page did not render a worked JSON example: the exact
 * top-level envelope on success (a `status` field, whether errors arrive as
 * an HTTP status or a `200` with an `error` string, `callCount`/`copyright`
 * housekeeping fields). Both fetch functions below are written defensively —
 * the same posture `parseForecast` takes with Open-Meteo — so a response that
 * arrives shaped differently than expected fails the tide row alone rather
 * than the page, and `TideError`'s message is what to read first if the
 * integration needs correcting against a real response.
 *
 * The docs list no field carrying a station's *distance* from the requested
 * coordinate in either response, only the station's own `lat`/`lon` — so
 * `nearestStation` (in `tide.ts`) computes it from those coordinates with
 * Scout's own geodesy rather than this file inventing a field to trust.
 *
 * ## Two caches, two lifetimes
 *
 * Unlike the forecast, a tide prediction for a given day does not go stale
 * the way weather does — it is closer to `almanac.ts`'s solved equinoxes than
 * to a forecast. But it is not cached forever either, the way a geocoded
 * place is: WorldTides can revise a station's harmonic fit, this is a paid
 * API worth bounding the call volume against on principle, and a bad key
 * should not stay "wrong" in the cache past a reasonable retry window. Six
 * hours splits that: long enough that scrubbing the date picker back and
 * forth across a session, or across a scouting afternoon, costs one request
 * per day looked at rather than one per scrub; short enough that a session
 * spanning more than half a working day, or a key that starts working again
 * after being added, sees it the same day.
 *
 * The *station* lookup is cached separately and far longer — tide gauges are
 * physical infrastructure, not predictions, and do not relocate between
 * sessions. It reuses the geocoder's own reasoning (`geocode.ts`'s header):
 * a place's nearest station is a fact about geography, not about a moment.
 */

const ENDPOINT = 'https://www.worldtides.info/api/v3';
const REQUEST_TIMEOUT_MS = 8000;

/** Six hours — see this file's header for the reasoning. */
export const TIDE_DAY_TTL_MS = 6 * 60 * 60_000;

export class TideError extends Error {}

/** Reads the key fresh each call rather than once at module load, so a test
 *  (or a key added mid-session, in dev) is not stuck with the first read. */
function apiKey(): string | null {
  const key = process.env.WORLDTIDES_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export const hasTideKey = (): boolean => apiKey() != null;

/* ── Cache ─────────────────────────────────────────────────────────────────── */

/** Two decimal places, ~1.1 km — see `weather-client.ts`'s `cacheKey` for the
 *  same reasoning: finer than either the harmonic model or the station grid
 *  resolves, so nudging the pin reuses an answer instead of re-asking. */
const coordKey = (lat: number, lon: number) => `${lat.toFixed(2)}_${lon.toFixed(2)}`.replace(/\./g, 'p');

async function readJsonCache<T>(dir: string, key: string, ttlMs: number | null): Promise<T | null> {
  try {
    const raw = await fs.readFile(path.join(dir, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { fetchedAt?: number; value?: T };
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (ttlMs != null && Date.now() - parsed.fetchedAt > ttlMs) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

async function writeJsonCache<T>(dir: string, key: string, value: T): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${key}.json`), JSON.stringify({ fetchedAt: Date.now(), value }));
  } catch (err) {
    // A cache that cannot be written is an extra request next time, not a failure now.
    console.warn('[scout] could not cache tide data', err);
  }
}

/* ── Fetching ──────────────────────────────────────────────────────────────── */

async function callApi(params: Record<string, string>): Promise<unknown> {
  const url = new URL(ENDPOINT);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new TideError('Could not reach WorldTides.');
  }
  // Even a well-formed WorldTides error can arrive as a 200 with a `status`/
  // `error` field per the docs prose (see header) — checked below, but an
  // HTTP-level failure is caught here first regardless of body shape.
  if (!response.ok) throw new TideError(`WorldTides answered ${response.status}.`);
  const body = await response.json();
  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status !== 200) {
    const message = (body as { error?: unknown } | null)?.error;
    throw new TideError(typeof message === 'string' ? message : `WorldTides reported status ${status}.`);
  }
  return body;
}

export type TideStationResult =
  | { status: 'no-key' }
  | { status: 'ok'; station: TideStation | null }
  | { status: 'error'; message: string };

/**
 * The nearest real tide station to a coordinate, or null if none is within
 * `MAX_STATION_DISTANCE_KM` — the coastal gate `tide.ts` documents.
 *
 * Cached indefinitely, like a geocoded place: this is a question about the
 * coastline near a coordinate, and the coastline does not move between
 * sessions.
 */
export async function fetchNearestTideStation(pin: LatLon): Promise<TideStationResult> {
  const key = apiKey();
  if (!key) return { status: 'no-key' };

  // Not `readJsonCache`: its `T | null` return cannot tell a real cache miss
  // apart from a cached "no station nearby", whose value is legitimately
  // null. `readCachedStationEntry` reads the raw entry once and says which.
  const cacheId = coordKey(pin.lat, pin.lon);
  const hit = await readCachedStationEntry(cacheId);
  if (hit.found) return { status: 'ok', station: hit.station };

  try {
    const body = await callApi({
      key,
      lat: pin.lat.toFixed(4),
      lon: pin.lon.toFixed(4),
      stations: '',
      stationDistance: String(MAX_STATION_DISTANCE_KM),
    });
    const candidates = parseStations(body);
    const station = nearestStation(pin, candidates);
    await writeJsonCache(SCOUT_TIDE_STATION_DIR, cacheId, station);
    return { status: 'ok', station };
  } catch (err) {
    if (err instanceof TideError) return { status: 'error', message: err.message };
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 'error', message: 'The tide station lookup timed out.' };
    }
    console.error('[scout/tide] station lookup failed', err);
    return { status: 'error', message: 'Could not look up the nearest tide station.' };
  }
}

/** `fs`'s "file absent" and "cached null" both need distinguishing from a
 *  cache miss, which `readJsonCache`'s `T | null` return cannot do alone —
 *  this small wrapper reads the raw entry once and says which case it was. */
async function readCachedStationEntry(
  cacheId: string,
): Promise<{ found: true; station: TideStation | null } | { found: false }> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_TIDE_STATION_DIR, `${cacheId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { fetchedAt?: number; value?: TideStation | null };
    if (typeof parsed?.fetchedAt !== 'number') return { found: false };
    return { found: true, station: parsed.value ?? null };
  } catch {
    return { found: false };
  }
}

export type TideDayResult =
  | { status: 'no-key' }
  | { status: 'ok'; extremes: TideExtreme[] }
  | { status: 'error'; message: string };

/**
 * A day's high/low extremes for a coordinate. `isoDate` is part of the cache
 * key — see this file's header for why the TTL is six hours rather than
 * forever or never.
 */
export async function fetchTideDay(pin: LatLon, isoDate: string): Promise<TideDayResult> {
  const key = apiKey();
  if (!key) return { status: 'no-key' };

  const cacheId = `${coordKey(pin.lat, pin.lon)}_${isoDate}`;
  const cached = await readJsonCache<TideExtreme[]>(SCOUT_TIDE_DAY_DIR, cacheId, TIDE_DAY_TTL_MS);
  if (cached) {
    // Cached extremes round-trip through JSON as strings; restore the `Date`s.
    return { status: 'ok', extremes: cached.map((e) => ({ ...e, at: new Date(e.at) })) };
  }

  try {
    const body = await callApi({
      key,
      lat: pin.lat.toFixed(4),
      lon: pin.lon.toFixed(4),
      date: isoDate,
      days: '1',
      extremes: '',
    });
    const extremes = parseExtremes(body);
    await writeJsonCache(SCOUT_TIDE_DAY_DIR, cacheId, extremes);
    return { status: 'ok', extremes };
  } catch (err) {
    if (err instanceof TideError) return { status: 'error', message: err.message };
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { status: 'error', message: 'The tide lookup timed out.' };
    }
    console.error('[scout/tide] day fetch failed', err);
    return { status: 'error', message: 'Could not fetch tide predictions.' };
  }
}
