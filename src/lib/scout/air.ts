/**
 * What the air is carrying, measured — aerosol optical depth at 550 nm.
 *
 * `atmosphere.ts` needs two numbers to say what colour the light is: how much
 * haze there is, and what size its particles are. It has only ever had table
 * values for both, which is why a coast and a desert with the sun at the same
 * height came out the same colour on a bad day and the panel had to say so.
 *
 * This is the half that can actually be measured. CAMS runs a global aerosol
 * forecast and Open-Meteo serves it keylessly from its air-quality host — a
 * *different* host from the weather one, which is the only reason this is a
 * module rather than three more fields on the forecast request. The other half,
 * the particle size, still cannot be had from anywhere and stays inferred from
 * the terrain; see `aerosolFor`.
 *
 * Pure, like `weather.ts`: parsing and lookup only. Both transports — the Mac's
 * cached server route and the published build's direct call — hand their JSON
 * to the same parser, so neither can drift from the other.
 */

export interface AirHour {
  /** UTC instant, as milliseconds. */
  time: number;
  /**
   * Aerosol optical depth at 550 nm: the total extinction of the whole column.
   *
   * Dimensionless. Roughly: 0.05 is an alpine day you remember, 0.1–0.2 is
   * ordinary, 0.4 is visible haze, and above 1 is smoke or dust you can taste.
   */
  aod550: number | null;
}

export interface AirReport {
  latitude: number;
  longitude: number;
  /** When it was fetched, so the panel can say how stale it is. */
  fetchedAt: number;
  hours: AirHour[];
}

interface OpenMeteoAir {
  latitude?: unknown;
  longitude?: unknown;
  hourly?: Record<string, unknown>;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Open-Meteo timestamps, which are naive local strings in the zone asked for.
 *
 * Every request here asks for UTC, so appending the marker is what makes
 * `Date.parse` read them as the instants they are rather than as the browser's
 * local time — the same reasoning, and the same trap, as `weather.ts`.
 */
function parseUtc(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value.endsWith('Z') ? value : `${value}Z`);
  return Number.isFinite(time) ? time : null;
}

export function parseAirQuality(body: unknown, fetchedAt: number): AirReport {
  const data = (body ?? {}) as OpenMeteoAir;
  const hourly = data.hourly ?? {};
  const times = Array.isArray(hourly.time) ? (hourly.time as unknown[]) : [];
  const depths = Array.isArray(hourly.aerosol_optical_depth)
    ? (hourly.aerosol_optical_depth as unknown[])
    : [];

  const hours: AirHour[] = [];
  for (let i = 0; i < times.length; i++) {
    const time = parseUtc(times[i]);
    if (time == null) continue;
    hours.push({ time, aod550: numberOrNull(depths[i]) });
  }

  return {
    latitude: numberOrNull(data.latitude) ?? 0,
    longitude: numberOrNull(data.longitude) ?? 0,
    fetchedAt,
    hours,
  };
}

/**
 * How far from the nearest hour a reading is still allowed to answer.
 *
 * Aerosol drifts over hours, not minutes, so an hour either side is the same
 * air. Past that the honest answer is no answer: the model is only published a
 * few days out, and a colour temperature computed from last Tuesday's dust
 * would look exactly as authoritative as one computed from today's.
 */
const NEAREST_MS = 90 * 60_000;

/** The aerosol depth covering an instant, or null past the end of the forecast. */
export function aodAt(
  report: AirReport | null | undefined,
  instant: Date | number,
): number | null {
  if (!report?.hours.length) return null;
  const time = typeof instant === 'number' ? instant : instant.getTime();

  let best: AirHour | null = null;
  let bestGap = Infinity;
  for (const hour of report.hours) {
    if (hour.aod550 == null) continue;
    const gap = Math.abs(hour.time - time);
    if (gap < bestGap) {
      bestGap = gap;
      best = hour;
    }
  }
  return best && bestGap <= NEAREST_MS ? best.aod550 : null;
}

/** The query both transports send, so they cannot ask for different things. */
export const AIR_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const AIR_HOURLY = 'aerosol_optical_depth';

export function airQualityUrl(latitude: number, longitude: number, days = 5): URL {
  const url = new URL(AIR_ENDPOINT);
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('hourly', AIR_HOURLY);
  url.searchParams.set('forecast_days', String(days));
  // UTC throughout, for the reason `parseUtc` above exists.
  url.searchParams.set('timezone', 'UTC');
  return url;
}
