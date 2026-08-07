import type { APIRoute } from 'astro';
import { AirError, fetchAirQuality } from '../../../lib/scout/air-client';

export const prerender = false;

// The aerosol column over a coordinate. Thin wrapper, like the weather route:
// the caching and the timeout live in the client so this stays a translation
// layer.
//
// Every failure here is a failure of one input to the light reading, never of
// the page. With no aerosol the panel falls back to the table it used before
// this existed, and says which it used — so an outage costs a word, not a row.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }

  try {
    return json({ ok: true, report: await fetchAirQuality(lat, lon) });
  } catch (err) {
    if (err instanceof AirError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'The aerosol forecast timed out.' }, 504);
    }
    console.error('[scout/air] failed', err);
    return json({ ok: false, error: 'Could not fetch the aerosol forecast.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
