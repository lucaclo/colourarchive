import type { APIRoute } from 'astro';
import { fetchNearestTideStation, fetchTideDay } from '../../../lib/scout/tide-client';

export const prerender = false;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tide for a coordinate and date — issue #71. Thin wrapper, like
 * `weather.ts` beside it: caching, the key check and the request shape all
 * live in `tide-client.ts`, this only translates query params to a JSON body.
 *
 * Two lookups run together: the nearest station (which decides whether the
 * spot is coastal enough to show a tide panel at all) and the day's extremes
 * (what to show once it is). They are reported separately rather than
 * collapsed into one status, because a caller with a cached station but a
 * failed day-fetch — or vice versa — needs to tell those apart to render the
 * honest state rather than either hiding a working coastal gate or losing it
 * to an unrelated network blip.
 */
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const date = url.searchParams.get('date');

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }
  if (!date || !ISO_DATE.test(date)) {
    return json({ ok: false, error: 'A date (YYYY-MM-DD) is needed.' }, 400);
  }

  const pin = { lat, lon };
  const [station, day] = await Promise.all([fetchNearestTideStation(pin), fetchTideDay(pin, date)]);

  return json({ ok: true, station, day });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
