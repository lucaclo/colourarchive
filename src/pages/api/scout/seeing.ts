import type { APIRoute } from 'astro';
import { SeeingError, fetchSeeingForecast } from '../../../lib/scout/seeing-client';

export const prerender = false;

// Seeing and transparency for a coordinate. Thin wrapper, like the weather
// and air routes: the caching and the timeout live in the client so this
// stays a translation layer.
//
// Every failure here is a failure of one optional line in one fold, never of
// the page — see seeing.ts and page.ts's renderSeeing for the "omit rather
// than error" rule this is answering to.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }

  try {
    return json({ ok: true, forecast: await fetchSeeingForecast(lat, lon) });
  } catch (err) {
    if (err instanceof SeeingError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'The seeing forecast timed out.' }, 504);
    }
    console.error('[scout/seeing] failed', err);
    return json({ ok: false, error: 'Could not fetch the seeing forecast.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
