import fs from 'node:fs/promises';
import path from 'node:path';
import { SCOUT_AURORA_DIR } from '../paths';
import { parseKpIndex, parseRealtimeReading, type SpaceWeather } from './aurora';

/**
 * Fetching NOAA SWPC's three keyless real-time feeds and folding them into
 * one `SpaceWeather` reading. Server-side and cached, for the usual reason —
 * a slider that fires many events a second must not become a burst of
 * requests to a free service — but the cache here is not keyed by
 * coordinate the way the weather and air ones are.
 *
 * **Space weather is not a property of the pin.** Kp is a whole-planet
 * index and Bz/solar-wind speed are single measurements taken at the L1
 * point, a million miles sunward of Earth — none of them vary with where
 * Scout's pin happens to be. Caching this per coordinate the way
 * `weather-client.ts` does would silently imply a location-specific reading
 * that does not exist, and would multiply one small fetch into one per spot
 * scouted for no reason. One file, refetched together, on one clock.
 */

const KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const WIND_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const MAG_URL = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
const REQUEST_TIMEOUT_MS = 8000;

/**
 * A few minutes, per issue #69: Kp itself only posts every three hours, but
 * the real-time wind and Bz feeds move minute to minute, and a reading
 * sitting on screen for the length of a scouting session should not be
 * stuck at whatever it was when the tab opened.
 */
export const AURORA_TTL_MS = 5 * 60_000;

const CACHE_FILE = path.join(SCOUT_AURORA_DIR, 'current.json');

export class AuroraError extends Error {}

async function readCache(): Promise<SpaceWeather | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as SpaceWeather;
    if (typeof parsed?.fetchedAt !== 'number') return null;
    if (Date.now() - parsed.fetchedAt > AURORA_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(reading: SpaceWeather): Promise<void> {
  try {
    await fs.mkdir(SCOUT_AURORA_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(reading));
  } catch (err) {
    // A cache that cannot be written is an extra request, not a failure.
    console.warn('[scout] could not cache the space-weather reading', err);
  }
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new AuroraError(`${new URL(url).host} answered ${response.status}.`);
  return response.json();
}

/**
 * The current space-weather reading: Kp, and Bz/solar-wind speed where
 * their own feeds answered.
 *
 * The three feeds are fetched together and allowed to fail independently —
 * the same posture `fetchHorizonPair` takes for the pin and gate forecasts.
 * Kp is the one load-bearing result: without it there is no oval boundary to
 * compute at all, so a failed Kp fetch throws. A failed wind or Bz fetch
 * does not — `aurora.ts`'s `auroraReading` already reports those as
 * individually-nullable facts, the same optionality `weather.ts` allows its
 * own cloud decks, so a partial NOAA outage costs one clause of the note,
 * not the whole reading.
 */
export async function fetchSpaceWeather(): Promise<SpaceWeather> {
  const cached = await readCache();
  if (cached) return cached;

  const [kpResult, windResult, magResult] = await Promise.allSettled([
    getJson(KP_URL),
    getJson(WIND_URL),
    getJson(MAG_URL),
  ]);

  if (kpResult.status === 'rejected') {
    const reason = kpResult.reason;
    if (reason instanceof Error && reason.name === 'TimeoutError') throw reason;
    throw new AuroraError('Could not reach the planetary K-index feed.');
  }
  const kp = parseKpIndex(kpResult.value);
  if (!kp) throw new AuroraError('The K-index feed came back empty.');

  const wind = windResult.status === 'fulfilled' ? parseRealtimeReading(windResult.value, 'proton_speed') : null;
  const mag = magResult.status === 'fulfilled' ? parseRealtimeReading(magResult.value, 'bz_gsm') : null;

  const reading: SpaceWeather = {
    kp: kp.kp,
    kpAtMs: kp.atMs,
    bzNt: mag?.value ?? null,
    windSpeedKmS: wind?.value ?? null,
    measuredAtMs: wind?.atMs ?? mag?.atMs ?? null,
    fetchedAt: Date.now(),
  };
  await writeCache(reading);
  return reading;
}
