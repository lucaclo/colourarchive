import type { APIRoute } from 'astro';
import { GeocodeError, searchPlaces } from '../../../lib/scout/geocode';

export const prerender = false;

// Place search for Scout. Thin wrapper over the server-side Nominatim client —
// the rate limiting, the identifying User-Agent and the disk cache all live
// there, so this route stays a translation layer and nothing else.
export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 6);

  if (query.trim().length < 2) {
    return json({ ok: true, places: [] });
  }

  try {
    const places = await searchPlaces(query, Number.isFinite(limit) ? limit : 6);
    return json({ ok: true, places });
  } catch (err) {
    // Distinguish "the service said no" from "we are broken", because the two
    // want different things from the person reading the message.
    if (err instanceof GeocodeError) {
      return json({ ok: false, error: err.message }, 502);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'Place search timed out.' }, 504);
    }
    console.error('[scout/geocode] failed', err);
    return json({ ok: false, error: 'Place search failed.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
