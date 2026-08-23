import type { APIRoute } from 'astro';
import { isoDateIn } from '../../../lib/scout/daylight';
import {
  WeatherError,
  fetchForecast,
  fetchHistoricalWeather,
  fetchHorizonPair,
} from '../../../lib/scout/weather-client';

export const prerender = false;

/** Strict `YYYY-MM-DD`, so a malformed date fails the check below rather than
 *  being handed to Open-Meteo's archive as a string comparison would allow. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * "Today", in whichever zone the caller says the pin sits in — the same zone
 * `isoDate` on the page was itself built from (`isoDateIn` in `daylight.ts`).
 * Falling back to server UTC when no zone is given keeps the check meaningful
 * even for a caller that omits it, rather than refusing the date outright.
 */
function todayFor(timeZone: string | null): string {
  try {
    if (timeZone) return isoDateIn(new Date(), timeZone);
  } catch {
    // An unrecognised IANA name falls through to the UTC default below.
  }
  return new Date().toISOString().slice(0, 10);
}

// The forecast for a coordinate. Thin wrapper, like the geocode route — the
// caching and the timeout live in the client so this stays a translation layer.
//
// Pass `bearing` and `gateKm` as well and it also fetches the sky the sunset
// light has to come through, which is a long way off in that direction and is
// the sample the horizon reading needs. That second forecast is allowed to fail
// on its own: `gate` comes back null and the page says the reading is unknown.
//
// Pass `date` on its own — issue #58 — and a date strictly before today routes
// to Open-Meteo's separate historical archive instead: the live forecast above
// cannot answer for a date that far back at all, and a photograph pinned to a
// spot is exactly that question. A `date` at or after today changes nothing;
// the live forecast already covers "now" through a week out on its own.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const bearingRaw = url.searchParams.get('bearing');
  const gateKmRaw = url.searchParams.get('gateKm');
  const dateRaw = url.searchParams.get('date');
  const tz = url.searchParams.get('tz');

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }

  if (dateRaw != null && ISO_DATE.test(dateRaw) && dateRaw < todayFor(tz)) {
    try {
      return json({ ok: true, report: await fetchHistoricalWeather(lat, lon, dateRaw) });
    } catch (err) {
      // Same posture as the live path below: this row is a garnish, never a
      // reason to take the rest of the page down with it.
      if (err instanceof WeatherError) return json({ ok: false, error: err.message }, 502);
      if (err instanceof Error && err.name === 'TimeoutError') {
        return json({ ok: false, error: 'The historical weather lookup timed out.' }, 504);
      }
      console.error('[scout/weather] historical fetch failed', err);
      return json({ ok: false, error: 'Could not fetch historical weather.' }, 500);
    }
  }

  const bearing = bearingRaw == null ? null : Number(bearingRaw);
  const gateKm = gateKmRaw == null ? 300 : Number(gateKmRaw);
  if (bearing != null && (!Number.isFinite(bearing) || !Number.isFinite(gateKm) || gateKm <= 0 || gateKm > 1000)) {
    return json({ ok: false, error: 'A bearing needs a sample distance of 1–1000 km.' }, 400);
  }

  try {
    if (bearing != null) {
      const pair = await fetchHorizonPair(lat, lon, bearing, gateKm * 1000);
      return json({
        ok: true,
        report: pair.pin,
        gate: pair.gate,
        gateAt: { lat: pair.gateLat, lon: pair.gateLon },
      });
    }
    return json({ ok: true, report: await fetchForecast(lat, lon) });
  } catch (err) {
    // The weather is a garnish on this page. Every failure below is reported as
    // a failure of the weather row alone, never of the page — the sun geometry
    // it sits beside does not depend on any of it.
    if (err instanceof WeatherError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'The forecast timed out.' }, 504);
    }
    console.error('[scout/weather] failed', err);
    return json({ ok: false, error: 'Could not fetch the forecast.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
