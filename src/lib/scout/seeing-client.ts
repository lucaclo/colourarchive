import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_SEEING_DIR } from '../paths';
import { parseSeeingForecast, seeingForecastUrl, type SeeingForecast } from './seeing';

/**
 * Fetching 7Timer's ASTRO forecast. Server-side and cached, for the same
 * reason as the weather and the aerosol column: 7Timer documents no rate
 * limit, which is a reason to be careful with it rather than a reason not to
 * be.
 */

const REQUEST_TIMEOUT_MS = 8000;

/**
 * Three hours — the forecast's own step, and inside 7Timer's stated
 * four-times-a-day update cadence. Refetching more often than the source
 * itself changes would only be asking the same question again.
 */
export const SEEING_TTL_MS = 3 * 60 * 60_000;

/** Three decimals, matching what the URL itself is built to. */
const cacheKey = (lat: number, lon: number) =>
  `${lat.toFixed(3)}_${lon.toFixed(3)}`.replace(/-/g, 'm').replace(/\./g, 'p');

export class SeeingError extends Error {}

async function readCache(key: string): Promise<SeeingForecast | null> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_SEEING_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as SeeingForecast;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > SEEING_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, forecast: SeeingForecast): Promise<void> {
  try {
    await fs.mkdir(SCOUT_SEEING_DIR, { recursive: true });
    await fs.writeFile(path.join(SCOUT_SEEING_DIR, `${key}.json`), JSON.stringify(forecast));
  } catch (err) {
    // A cache that cannot be written is an extra request, not a failure.
    console.warn('[scout] could not cache the seeing forecast', err);
  }
}

/**
 * Seeing and transparency for a coordinate, three days out.
 *
 * No CORS on 7Timer's own response — confirmed against the live host, not
 * assumed — so unlike the weather and the aerosol column there is no direct,
 * client-side path for a static build. This one function is server-only, the
 * published archive's panel simply omits the line, and that omission is the
 * whole of what a missing seeing forecast is allowed to cost.
 */
export async function fetchSeeingForecast(latitude: number, longitude: number): Promise<SeeingForecast> {
  const key = cacheKey(latitude, longitude);
  const cached = await readCache(key);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch(seeingForecastUrl(latitude, longitude), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new SeeingError('Could not reach 7Timer.');
  }
  if (!response.ok) throw new SeeingError(`7Timer answered ${response.status}.`);

  const forecast = parseSeeingForecast(await response.json(), Date.now());
  if (!forecast.points.length) throw new SeeingError('The seeing forecast came back empty.');
  await writeCache(key, forecast);
  return forecast;
}
