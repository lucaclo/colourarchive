import type { Config, Context } from '@netlify/functions';
import { GeocodeError, searchPlaces } from '../../src/lib/scout/geocode';

/**
 * Place search for the published Scout.
 *
 * The one piece of server the static build needs. Nominatim sends no CORS header
 * under any query string, so a page cannot call it — measured, not assumed — and
 * without this the published Scout would have no way to start except by dragging
 * the pin around an unlabelled map.
 *
 * It imports the same `searchPlaces` the Astro route does, so the rate limiting,
 * the identifying User-Agent and the parsing are one implementation rather than
 * two. The disk cache inside it simply does not apply here: the filesystem is
 * read-only, `writeCache` already treats that as "a slower search, not a broken
 * one", and each function instance keeps its own rate-limit chain — which is the
 * conservative direction to be wrong in.
 *
 * The path is the same one the Mac serves, so the page's fetch is identical in
 * both arrangements and neither has a branch for the other.
 */
export default async (request: Request, _context: Context): Promise<Response> => {
  const url = new URL(request.url);
  const query = url.searchParams.get('q') ?? '';
  const limit = Number(url.searchParams.get('limit') ?? 6);

  if (query.trim().length < 2) return json({ ok: true, places: [] });

  try {
    const places = await searchPlaces(query, Number.isFinite(limit) ? limit : 6);
    return json({ ok: true, places });
  } catch (err) {
    if (err instanceof GeocodeError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'Place search timed out.' }, 504);
    }
    console.error('[scout/geocode] failed', err);
    return json({ ok: false, error: 'Place search failed.' }, 500);
  }
};

export const config: Config = { path: '/api/scout/geocode' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // A place does not move. Letting the CDN hold the answer is the closest
      // thing here to the disk cache on the Mac, and it is what keeps a free
      // service from being asked the same question by every visitor.
      'cache-control': 'public, max-age=86400',
    },
  });
}
