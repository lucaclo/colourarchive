import type { APIRoute } from 'astro';
import { AuroraError, fetchSpaceWeather } from '../../../lib/scout/aurora-client';

export const prerender = false;

// The real-time space-weather reading: Kp, Bz, solar wind speed. Thin
// wrapper, like the weather, air and seeing routes — the caching and the
// timeout live in the client so this stays a translation layer.
//
// No coordinates: unlike every other route here, this reading is not a
// property of a place, so there is nothing to validate on the way in — see
// aurora-client.ts's own note on why one fetch serves the whole page.
//
// A failure here is refused as a failure, not read as "no aurora" — see
// aurora.ts's `auroraReading`, which treats a missing reading as its own
// named absence rather than folding it into a quiet night.
export const GET: APIRoute = async () => {
  try {
    return json({ ok: true, reading: await fetchSpaceWeather() });
  } catch (err) {
    if (err instanceof AuroraError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'The space-weather feed timed out.' }, 504);
    }
    console.error('[scout/aurora] failed', err);
    return json({ ok: false, error: 'Could not fetch the space-weather reading.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
