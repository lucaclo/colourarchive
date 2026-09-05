import type { APIRoute } from 'astro';
import { PhotoError, toHotspots } from '../../../lib/scout/sources/photo-client';
import { fetchSpotPhotos } from '../../../lib/scout/sources/spot-photos';
import { MAX_PHOTOS, PHOTO_SEARCH_RADIUS_M } from '../../../lib/scout/sources/types';

export const prerender = false;

// Photographs other people have taken near a coordinate, grouped into the
// places they were taken from. Thin, like the other scout routes — the caching,
// the timeout and the clustering all live in the library.
export const GET: APIRoute = async ({ url }) => {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  const radiusM = Number(url.searchParams.get('radius'));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ ok: false, error: 'A latitude and longitude are needed.' }, 400);
  }

  try {
    const { photos, tiers } = await fetchSpotPhotos({
      centre: { lat, lon },
      // Capped here as well as at the caller: this route is reachable directly,
      // and a 200 km radius would be somebody else's bandwidth.
      radiusM: Math.min(PHOTO_SEARCH_RADIUS_M, Number.isFinite(radiusM) ? radiusM : PHOTO_SEARCH_RADIUS_M),
      limit: MAX_PHOTOS,
    });
    // Photographs, wherever they came from, do not move and their licences
    // do not change, so a reload should not pay for this again.
    return json(
      { ok: true, hotspots: toHotspots(photos), photoCount: photos.length, tiers },
      200,
      { 'cache-control': 'public, max-age=1800' },
    );
  } catch (err) {
    // Spot photographs are an addition to this page, never a dependency of it.
    // Every failure here is reported as a failure of the photo layer alone —
    // the sun and the shadows beside it do not need any of this to be right.
    if (err instanceof PhotoError) return json({ ok: false, error: err.message }, 502);
    if (err instanceof Error && err.name === 'TimeoutError') {
      return json({ ok: false, error: 'The photo search timed out.' }, 504);
    }
    console.error('[scout/photos] failed', err);
    return json({ ok: false, error: 'Could not search for photographs.' }, 500);
  }
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
