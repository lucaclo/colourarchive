import type { APIRoute } from 'astro';
import { reverseGeocode } from '../../../lib/scout/geocode';

export const prerender = false;

// A coordinate to a place name, for the dragged pin. `reverseGeocode` never
// throws for a lookup failure — it falls back to the coordinate itself — so the
// only errors this can report are bad inputs.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }

  try {
    return json({ ok: true, place: await reverseGeocode(lat, lon) });
  } catch (err) {
    console.error('[scout/reverse] failed', err);
    return json({ ok: false, error: 'Could not name that point.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
