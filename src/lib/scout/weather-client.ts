import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_WEATHER_DIR } from '../paths';
import { destination } from './geo';
import { parseForecast, type WeatherReport } from './weather';

/**
 * Fetching the forecast. Server-side, like the geocoder, and for one of the same
 * reasons: a browser scrubbing the time slider would otherwise hammer a free
 * service that asks not to be hammered.
 *
 * The other reason is different, though. Places do not move, so a geocode is
 * cached forever. A forecast goes off, so this cache is deliberately short — long
 * enough that dragging the slider across a day costs one request, short enough
 * that a forecast on screen is never meaningfully older than the last time you
 * looked at the page.
 */

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 8000;

/** Twenty minutes. Open-Meteo updates hourly; this is well inside that. */
export const WEATHER_TTL_MS = 20 * 60_000;

/**
 * Coordinates rounded before they become a cache key.
 *
 * Two decimal places is about 1.1 km, which is far finer than any weather model
 * resolves — Open-Meteo's finest domains are a kilometre or two. Rounding means
 * nudging the pin down the street reuses the forecast instead of fetching an
 * identical one, and it keeps the cache from filling with near-duplicates.
 */
const cacheKey = (lat: number, lon: number) => `${lat.toFixed(2)}_${lon.toFixed(2)}`.replace(/\./g, 'p');

export class WeatherError extends Error {}

async function readCache(key: string): Promise<WeatherReport | null> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_WEATHER_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as WeatherReport;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > WEATHER_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, report: WeatherReport): Promise<void> {
  try {
    await fs.mkdir(SCOUT_WEATHER_DIR, { recursive: true });
    await fs.writeFile(path.join(SCOUT_WEATHER_DIR, `${key}.json`), JSON.stringify(report));
  } catch (err) {
    // A cache that cannot be written is an extra request, not a failure.
    console.warn('[scout] could not cache forecast', err);
  }
}

/**
 * The forecast for a coordinate: seven days of hours, plus the current
 * conditions.
 *
 * Seven days because the date picker can move a week out and the panel should
 * not go blank the moment it does. Beyond that `hourAt` returns null and the UI
 * says there is no forecast, which is the truth.
 */
export async function fetchForecast(latitude: number, longitude: number): Promise<WeatherReport> {
  const key = cacheKey(latitude, longitude);
  const cached = await readCache(key);
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  // The three decks alongside the total. They cost nothing extra on the wire and
  // they are the difference between "80% cloud" meaning a grey afternoon and
  // meaning cirrus over a clear sun. See `cloudStructure` for what reads them.
  url.searchParams.set(
    'current',
    'temperature_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high',
  );
  url.searchParams.set(
    'hourly',
    'temperature_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,visibility',
  );
  url.searchParams.set('forecast_days', '7');
  // UTC throughout. Scout already knows the place's IANA zone and does its own
  // formatting; asking the API to localise as well is two chances to be wrong.
  url.searchParams.set('timezone', 'UTC');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new WeatherError('Could not reach the forecast service.');
  }
  if (!response.ok) throw new WeatherError(`Open-Meteo answered ${response.status}.`);

  const report = parseForecast(await response.json(), Date.now());
  if (!report.hours.length) throw new WeatherError('The forecast came back empty.');
  await writeCache(key, report);
  return report;
}

export interface HorizonPair {
  /** The forecast where you are standing. */
  pin: WeatherReport;
  /** The forecast where the sun's last light passes, or null if it failed. */
  gate: WeatherReport | null;
  gateLat: number;
  gateLon: number;
}

/**
 * Two forecasts: here, and where the light comes from.
 *
 * Two requests rather than Open-Meteo's multi-coordinate form on purpose. They
 * run together so the latency is one round trip either way, they reuse the same
 * per-coordinate cache the pin already fills, and — the reason that decides it —
 * a failure at the far sample degrades the horizon reading to "unknown" instead
 * of taking the pin's own forecast down with it. One response for two questions
 * would have made them fail together.
 *
 * The far sample is clamped to the poles and wrapped in longitude, so a bearing
 * that walks three hundred kilometres off the top of the world still asks about
 * a real place.
 */
export async function fetchHorizonPair(
  latitude: number,
  longitude: number,
  bearing: number,
  distanceM: number,
): Promise<HorizonPair> {
  const far = destination({ lat: latitude, lon: longitude }, bearing, distanceM);
  const gateLat = Math.min(90, Math.max(-90, far.lat));
  const gateLon = ((((far.lon + 180) % 360) + 360) % 360) - 180;

  const [pin, gate] = await Promise.all([
    fetchForecast(latitude, longitude),
    fetchForecast(gateLat, gateLon).catch(() => null),
  ]);
  return { pin, gate, gateLat, gateLon };
}
