import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_AIR_DIR } from '../paths';
import { airQualityUrl, parseAirQuality, type AirReport } from './air';

/**
 * Fetching the aerosol forecast. Server-side and cached, for the same reasons
 * as the weather: a slider being dragged must not become a request per frame to
 * a free service that asks not to be hammered.
 *
 * Cached longer than the forecast, though, because it is a different kind of
 * quantity. Cloud can change in twenty minutes and the panel would be wrong to
 * show the old one; the aerosol column over a place is a smooth field that
 * moves over half a day. An hour of staleness is invisible in the answer, and
 * it turns a day of scouting into two or three requests.
 */

const REQUEST_TIMEOUT_MS = 8000;

/** One hour. CAMS itself only publishes a few times a day. */
export const AIR_TTL_MS = 60 * 60_000;

/** Two decimals is about 1.1 km — far finer than a global aerosol model resolves. */
const cacheKey = (lat: number, lon: number) =>
  `${lat.toFixed(2)}_${lon.toFixed(2)}`.replace(/\./g, 'p');

export class AirError extends Error {}

async function readCache(key: string): Promise<AirReport | null> {
  try {
    const raw = await fs.readFile(path.join(SCOUT_AIR_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as AirReport;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > AIR_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, report: AirReport): Promise<void> {
  try {
    await fs.mkdir(SCOUT_AIR_DIR, { recursive: true });
    await fs.writeFile(path.join(SCOUT_AIR_DIR, `${key}.json`), JSON.stringify(report));
  } catch (err) {
    // A cache that cannot be written is an extra request, not a failure.
    console.warn('[scout] could not cache the aerosol forecast', err);
  }
}

/**
 * The aerosol column over a coordinate, five days of hours.
 *
 * Fewer days than the forecast's seven because CAMS does not publish further,
 * and past the end `aodAt` returns null and the light falls back to the table —
 * which is what it did everywhere before this existed.
 */
export async function fetchAirQuality(latitude: number, longitude: number): Promise<AirReport> {
  const key = cacheKey(latitude, longitude);
  const cached = await readCache(key);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch(airQualityUrl(latitude, longitude), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') throw err;
    throw new AirError('Could not reach the air-quality service.');
  }
  if (!response.ok) throw new AirError(`Open-Meteo answered ${response.status}.`);

  const report = parseAirQuality(await response.json(), Date.now());
  if (!report.hours.length) throw new AirError('The aerosol forecast came back empty.');
  await writeCache(key, report);
  return report;
}
