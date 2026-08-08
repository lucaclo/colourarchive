/**
 * Scout's data sources, fetched from the page.
 *
 * On the Mac, Scout talks to four endpoints of its own and those endpoints talk
 * to the outside world. That is the right arrangement: the rate limiting is
 * real, the User-Agent is honest, and answers are cached to disk across visits.
 *
 * The published archive is a static build with no server behind it, so the same
 * page has to reach the same services directly. Two of the three can be reached
 * that way and one cannot:
 *
 *   - **Open-Meteo** sends `access-control-allow-origin: *`. Straight through.
 *   - **Wikimedia Commons** sends nothing by default and needs `origin=*`, its
 *     documented opt-in for an anonymous cross-origin read. See `wikimedia.ts`.
 *   - **Nominatim** sends no CORS header at all and cannot be called from a page
 *     under any query string. Place search and the dragged pin's name keep going
 *     to `/api/scout/…`, which the host answers with a function. That is the one
 *     piece of server the published Scout needs, and it is why it exists.
 *
 * Everything here reuses the same parsers the server path does — `parseForecast`,
 * `collectCommonsPhotos`, `toHotspots` — so the two produce the same objects. A
 * second implementation of any of them would be a second thing to keep correct.
 */

import { destination, type LatLon } from '../geo';
import { parseForecast, type WeatherReport } from '../weather';
import { airQualityUrl, parseAirQuality, type AirReport } from '../air';
import { collectCommonsPhotos, toHotspots, type Hotspot } from '../sources/photo-client';
import { MAX_PHOTOS, PHOTO_SEARCH_RADIUS_M, type SpotSearch } from '../sources/types';

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

/**
 * Shorter than the server's eight seconds.
 *
 * A server fetch that takes eight seconds costs one visitor one slow answer. The
 * same wait in the page is eight seconds of a panel saying nothing on a phone
 * that may be on a hilltop with one bar, and the geometry beside it — which is
 * the actual product — needs none of it. Fail sooner and say so.
 */
const TIMEOUT_MS = 6000;

/**
 * In-memory, for the length of the visit.
 *
 * The disk cache lives on the Mac and there is no disk here. Without something
 * the page would refetch on every pin drag, and Open-Meteo asks not to be
 * hammered as plainly as Nominatim does — it just does not enforce it.
 */
const WEATHER_TTL_MS = 20 * 60_000;
const weatherCache = new Map<string, { at: number; report: WeatherReport }>();

/** Two decimal places is about 1.1 km — finer than any weather model resolves. */
const weatherKey = (lat: number, lon: number) => `${lat.toFixed(2)},${lon.toFixed(2)}`;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    // No User-Agent: it is a forbidden header name in `fetch` and setting it
    // from a page does nothing at all. Better to not write the line than to
    // write one that looks like identification and is dropped.
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  return response.json();
}

/* ── Weather ───────────────────────────────────────────────────────────────── */

/** The same columns the server asks for, so both paths parse the same shape. */
const HOURLY =
  'temperature_2m,dew_point_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,visibility';
const CURRENT = 'temperature_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high';

export async function fetchForecastDirect(
  latitude: number,
  longitude: number,
): Promise<WeatherReport> {
  const key = weatherKey(latitude, longitude);
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return hit.report;

  const url = new URL(OPEN_METEO);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('current', CURRENT);
  url.searchParams.set('hourly', HOURLY);
  url.searchParams.set('forecast_days', '7');
  // UTC throughout, as on the server: Scout knows the place's IANA zone and does
  // its own formatting, and asking the API to localise too is two chances to be
  // wrong about the same hour.
  url.searchParams.set('timezone', 'UTC');

  const report = parseForecast(await getJson(url.toString()), Date.now());
  if (!report.hours.length) throw new Error('The forecast came back empty.');
  weatherCache.set(key, { at: Date.now(), report });
  return report;
}

/* ── Aerosol ───────────────────────────────────────────────────────────────── */

/**
 * The aerosol column, straight from Open-Meteo's air-quality host.
 *
 * Verified to send `access-control-allow-origin: *`, the same as the forecast
 * host — which had to be checked rather than assumed, since it is a different
 * host and the rule that Nominatim cannot be reached this way was learned the
 * same way.
 *
 * Held for an hour rather than the forecast's twenty minutes: the column is a
 * smooth field that moves over half a day, so a stale reading is not a wrong
 * one. See `air-client.ts`, which caches to disk on the same reasoning.
 */
const AIR_TTL_MS = 60 * 60_000;
const airCache = new Map<string, { at: number; report: AirReport }>();

export async function fetchAirQualityDirect(
  latitude: number,
  longitude: number,
): Promise<AirReport> {
  const key = weatherKey(latitude, longitude);
  const hit = airCache.get(key);
  if (hit && Date.now() - hit.at < AIR_TTL_MS) return hit.report;

  const report = parseAirQuality(
    await getJson(airQualityUrl(latitude, longitude).toString()),
    Date.now(),
  );
  if (!report.hours.length) throw new Error('The aerosol forecast came back empty.');
  airCache.set(key, { at: Date.now(), report });
  return report;
}

export interface HorizonPairDirect {
  pin: WeatherReport;
  /** Null when the far sample failed — the reading then says it does not know. */
  gate: WeatherReport | null;
  gateLat: number;
  gateLon: number;
}

/**
 * Here, and the sky the low light has to come through.
 *
 * Mirrors `fetchHorizonPair` on the server, including the part that matters: the
 * far sample is allowed to fail on its own. A horizon reading that cannot be
 * made is a sentence saying so, never a reason for the pin's own forecast to go
 * missing.
 */
export async function fetchHorizonPairDirect(
  latitude: number,
  longitude: number,
  bearing: number,
  distanceM: number,
): Promise<HorizonPairDirect> {
  const far = destination({ lat: latitude, lon: longitude }, bearing, distanceM);
  const gateLat = Math.min(90, Math.max(-90, far.lat));
  const gateLon = ((((far.lon + 180) % 360) + 360) % 360) - 180;

  const [pin, gate] = await Promise.all([
    fetchForecastDirect(latitude, longitude),
    fetchForecastDirect(gateLat, gateLon).catch(() => null),
  ]);
  return { pin, gate, gateLat, gateLon };
}

/* ── Photographs ───────────────────────────────────────────────────────────── */

export interface PhotoResultDirect {
  hotspots: Hotspot[];
  photoCount: number;
}

/**
 * Assessed Commons photographs near a point, grouped into hotspots.
 *
 * The radius is clamped here as it is on the server route, for the same reason:
 * this is somebody else's bandwidth and a wide search is a lot of it.
 */
export async function fetchPhotosDirect(
  centre: LatLon,
  radiusM: number,
): Promise<PhotoResultDirect> {
  const query: SpotSearch = {
    centre,
    radiusM: Math.min(PHOTO_SEARCH_RADIUS_M, Number.isFinite(radiusM) ? radiusM : PHOTO_SEARCH_RADIUS_M),
    limit: MAX_PHOTOS,
  };
  const photos = await collectCommonsPhotos(query, getJson, { cors: true });
  return { hotspots: toHotspots(photos), photoCount: photos.length };
}
