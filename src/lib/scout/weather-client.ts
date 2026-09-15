import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_WEATHER_DIR } from '../paths';
import { sweepStaleCache } from './cache-sweep';
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
/**
 * Open-Meteo's separate historical archive — issue #58. The live forecast
 * endpoint above only reaches a handful of days into the past; a photograph
 * pinned to a spot usually needs far more than that, and the archive is
 * where "what was the sky actually doing that evening" lives instead.
 */
const HISTORICAL_ENDPOINT = 'https://archive-api.open-meteo.com/v1/archive';
const REQUEST_TIMEOUT_MS = 8000;

/** Twenty minutes. Open-Meteo updates hourly; this is well inside that. */
export const WEATHER_TTL_MS = 20 * 60_000;

// A spot rarely revisited within the TTL leaves its file behind forever
// otherwise — sweep it once per process start. Historical entries (`hist_`)
// are excluded: `readCache` never expires them by design, so a sweep must not
// either.
sweepStaleCache(SCOUT_WEATHER_DIR, WEATHER_TTL_MS, (name) => !name.startsWith('hist_')).catch(() => {});

/**
 * Coordinates rounded before they become a cache key.
 *
 * Two decimal places is about 1.1 km, which is far finer than any weather model
 * resolves — Open-Meteo's finest domains are a kilometre or two. Rounding means
 * nudging the pin down the street reuses the forecast instead of fetching an
 * identical one, and it keeps the cache from filling with near-duplicates.
 */
const cacheKey = (lat: number, lon: number) => `${lat.toFixed(2)}_${lon.toFixed(2)}`.replace(/\./g, 'p');

/**
 * A day is part of the key here, unlike the live cache — two different dates
 * at the same coordinate are two different, both worth keeping, answers.
 */
const historicalCacheKey = (lat: number, lon: number, isoDate: string) =>
  `hist_${cacheKey(lat, lon)}_${isoDate}`;

export class WeatherError extends Error {}

/**
 * `ttlMs: null` means the entry never goes stale — the right rule for a
 * historical read, since the past does not update the way a live forecast
 * does. The live cache passes `WEATHER_TTL_MS` and keeps its old behaviour.
 */
async function readCache(key: string, ttlMs: number | null = WEATHER_TTL_MS): Promise<WeatherReport | null> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_WEATHER_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as WeatherReport;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (ttlMs != null && Date.now() - parsed.fetchedAt > ttlMs) return null;
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
    'temperature_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_gusts_10m',
  );
  url.searchParams.set(
    'hourly',
    // The dew point rides along on a request that was being made anyway. It is
    // the only published number that says how much water is in the column above
    // the pin, which `precipitableWater` turns into Bird's water term — and
    // that term had been a fixed 1.5 cm everywhere from the Sahara to Bergen.
    // Wind rides along the same way: a tripod and a long exposure are already
    // this page's subject, and Open-Meteo answers it on the same request.
    'temperature_2m,dew_point_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation_probability,visibility,wind_speed_10m,wind_gusts_10m',
  );
  url.searchParams.set('wind_speed_unit', 'kmh');
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

/**
 * What the sky was actually doing on a past date, at a coordinate — issue #58.
 *
 * `isoDate` rather than an instant: Open-Meteo's archive is queried by day and
 * answers with every hour in it, the same shape `hourAt` already reads a live
 * forecast through, so the rest of Scout's engine — `lighting.ts`, the cloud
 * panel — treats a reconstructed evening exactly like a planned one and needs
 * no parallel code path.
 *
 * No `current` conditions here — there is no "now" for a date already gone —
 * and no gate/horizon sample: that pull is a forecast of what stands between
 * here and the horizon *today*, which is not a question a past date can be
 * asked. `parseForecast` already treats a missing `current` block as `null`,
 * so this reuses it unchanged rather than writing a second parser.
 */
export async function fetchHistoricalWeather(
  latitude: number,
  longitude: number,
  isoDate: string,
): Promise<WeatherReport> {
  const key = historicalCacheKey(latitude, longitude, isoDate);
  const cached = await readCache(key, null);
  if (cached) return cached;

  const url = new URL(HISTORICAL_ENDPOINT);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('start_date', isoDate);
  url.searchParams.set('end_date', isoDate);
  // No precipitation_probability: a *probability* is a forecast concept, and
  // the archive answers with null for it on every hour rather than refuse —
  // asking for a measured record instead of a chance is the honest request.
  url.searchParams.set(
    'hourly',
    'temperature_2m,dew_point_2m,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_gusts_10m',
  );
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', 'UTC');

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new WeatherError('Could not reach the historical weather service.');
  }
  if (!response.ok) throw new WeatherError(`Open-Meteo's archive answered ${response.status}.`);

  const report = parseForecast(await response.json(), Date.now());
  if (!report.hours.length) {
    throw new WeatherError('No historical weather on record for that date and place.');
  }
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
