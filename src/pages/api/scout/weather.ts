import type { APIRoute } from 'astro';
import { WeatherError, fetchForecast, fetchHorizonPair } from '../../../lib/scout/weather-client';

export const prerender = false;

// The forecast for a coordinate. Thin wrapper, like the geocode route — the
// caching and the timeout live in the client so this stays a translation layer.
//
// Pass `bearing` and `gateKm` as well and it also fetches the sky the sunset
// light has to come through, which is a long way off in that direction and is
// the sample the horizon reading needs. That second forecast is allowed to fail
// on its own: `gate` comes back null and the page says the reading is unknown.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const bearingRaw = url.searchParams.get('bearing');
  const gateKmRaw = url.searchParams.get('gateKm');

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
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
