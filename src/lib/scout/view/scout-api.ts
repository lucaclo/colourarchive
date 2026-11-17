/**
 * The two calls that still need a server, and what to say when there isn't one.
 *
 * Everything else on this page reaches its source directly; Nominatim sends no
 * CORS header, so place search and the pin's name go through `/api/scout/…`,
 * answered by the Mac. The published build has no server: there the same two
 * URLs are answered here in the page, from Nominatim through the site's own
 * proxy (`/nominatim/*` in public/_redirects), read by the same parser the Mac uses
 * (../nominatim.ts). Netlify's function upload has refused this site's
 * functions since August 2026; a proxy rule needs no function.
 *
 * When neither is there — a Netlify **Drop** deploy carries no functions at
 * all, which is the documented way this archive gets published — that path
 * returns the host's 404 *page*. Calling `.json()` on HTML throws
 * "Unexpected token '<'", and that string was landing in the results list as
 * though it were a search result. Detect it here and say the true thing
 * instead: search is unavailable, the map still is.
 *
 * **What it says next has to be something you can do.** The first version sent
 * you to drag the pin, and the pin does not exist until a spot has been chosen —
 * so on a phone, where there is no keyboard route in either, the advice closed
 * the last door. Tapping the map now places the first spot, and this names that.
 */

/**
 * A geocoder result, as `/api/scout/geocode` and `/api/scout/reverse` return it.
 *
 * `bounds` is Nominatim's own, and is what a whole-city result is framed by —
 * a point at the centre of Tokyo says nothing about how far Tokyo reaches.
 */
export type { Place } from '../nominatim';
import { coordinatePlace, reverseParams, searchParams, toPlace, toPlaces, type NominatimResult, type TimeZoneOf } from '../nominatim';

export class NoSearchServer extends Error {
  constructor() {
    super('Place search needs the server. Zoom in and tap the map to choose a spot instead.');
    // Set explicitly: extending a built-in loses the constructor's name under
    // the ES5 downlevel some toolchains still emit, and this name is how the
    // failure is recognised in a log.
    this.name = 'NoSearchServer';
  }
}

/**
 * Fetch JSON from one of Scout's own endpoints, or say there is no endpoint.
 *
 * The content type is the test rather than the status, because the failure this
 * exists for answers **200** — a static host serving its 404 page is, as far as
 * HTTP is concerned, a successful request for a document.
 */
export async function getScoutJson(url: string): Promise<any> {
  if (STATIC) {
    const answer = await answerInBrowser(url);
    if (answer) return answer;
  }
  const response = await fetch(url);
  if (!(response.headers.get('content-type') || '').includes('json')) throw new NoSearchServer();
  return response.json();
}

/* ── The published build: search and names from the page itself ──────────── */

const STATIC = import.meta.env?.PUBLIC_STATIC === 'true';

/** The site's own path to Nominatim (public/_redirects): same origin, so no CORS. */
const PROXY = '/nominatim';

/** tz-lookup's 172 KB of polygons, fetched on the first search, never before. */
let zones: Promise<TimeZoneOf> | null = null;
function timeZones(): Promise<TimeZoneOf> {
  zones ??= import('tz-lookup')
    .then((m) => {
      const lookup = ((m as { default?: unknown }).default ?? m) as (lat: number, lon: number) => string;
      return (lat: number, lon: number) => {
        try {
          return lookup(lat, lon);
        } catch {
          return 'UTC';
        }
      };
    })
    .catch(() => () => 'UTC');
  return zones;
}

/** One request a second, as Nominatim asks and as the Mac keeps to. */
let queue: Promise<unknown> = Promise.resolve();
let lastAt = 0;
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = 1100 - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    return task();
  });
  queue = run.catch(() => undefined);
  return run;
}

const isJson = (r: Response) => (r.headers.get('content-type') || '').includes('json');

/**
 * `/api/scout/geocode` and `/api/scout/reverse`, answered in the page with the
 * same JSON the Mac sends; null for any other URL. A search that can't reach
 * the proxy says so (NoSearchServer); a name that can't be had falls back to
 * the coordinate written out, as on the Mac.
 */
export async function answerInBrowser(
  url: string,
  fetcher: (input: string) => Promise<Response> = (input) => fetch(input),
  timeZoneOf?: TimeZoneOf,
): Promise<unknown | null> {
  const asked = new URL(url, 'https://scout.invalid');
  if (asked.pathname === '/api/scout/geocode') {
    const query = asked.searchParams.get('q') ?? '';
    if (query.trim().length < 2) return { ok: true, places: [] };
    const limit = Number(asked.searchParams.get('limit') ?? 6);
    const response = await inTurn(() => fetcher(`${PROXY}/search?${searchParams(query, limit)}`)).catch(() => null);
    if (!response || !response.ok || !isJson(response)) throw new NoSearchServer();
    return { ok: true, places: toPlaces(await response.json(), timeZoneOf ?? (await timeZones())) };
  }
  if (asked.pathname === '/api/scout/reverse') {
    const lat = Number(asked.searchParams.get('lat'));
    const lon = Number(asked.searchParams.get('lon'));
    const zoom = Number(asked.searchParams.get('zoom') ?? 16) || 16;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: 'A latitude and longitude are needed.' };
    }
    const tzOf = timeZoneOf ?? (await timeZones());
    const fallback = coordinatePlace(lat, lon, tzOf);
    try {
      const response = await inTurn(() => fetcher(`${PROXY}/reverse?${reverseParams(fallback.lat, fallback.lon, zoom)}`));
      if (!response.ok || !isJson(response)) return { ok: true, place: fallback };
      const place = toPlace((await response.json()) as NominatimResult, tzOf);
      // The point asked about is the point meant: borrow the name, keep the coordinate.
      return { ok: true, place: place ? { ...place, lat: fallback.lat, lon: fallback.lon } : fallback };
    } catch {
      return { ok: true, place: fallback };
    }
  }
  return null;
}
