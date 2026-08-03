import type { Config, Context } from '@netlify/functions';
import { reverseGeocode } from '../../src/lib/scout/geocode';

/**
 * A coordinate to a place name, for the dragged pin.
 *
 * The other half of what Nominatim is needed for, and the half that makes the
 * dragged pin worth having: a coordinate you chose deliberately is still just a
 * pair of numbers until something names it. Same reasoning as `geocode.mts` —
 * the shared client, the same path the Mac serves.
 *
 * `reverseGeocode` never throws for a lookup failure; it falls back to the
 * coordinate itself. So the only errors reachable here are bad inputs.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  const url = new URL(request.url);
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

export const config: Config = { path: '/api/scout/reverse' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=86400',
    },
  });
}
