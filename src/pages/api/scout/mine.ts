import type { APIRoute } from 'astro';
import { readManifest } from '../../../lib/manifest';
import { readPlacedLocations, setPlacedLocation } from '../../../lib/photo-locations';
import { isLatLon, resolveMinePhotos } from '../../../lib/scout/mine';
import { oklchCss } from '../../../lib/color';

export const prerender = false;

// Every archive photo, located where it can be. Fetched at runtime rather
// than baked into the page: /scout is prerendered, so a baked list would go
// stale on the Mac server the moment a photo was placed.
export const GET: APIRoute = async () => {
  try {
    const [manifest, placed] = await Promise.all([readManifest(), readPlacedLocations()]);
    const chapters = manifest.chapters.map((c) => ({ name: c.name, colour: oklchCss(c.oklch), photos: c.photos }));
    return json({ ok: true, photos: resolveMinePhotos(chapters, placed) });
  } catch (err) {
    console.error('[scout/mine] read failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

// Place one archive photo on Scout's map, or clear its placement.
// Body: { id, location: { lat, lon } | null }. Writes photos.locations.json,
// which is git-ignored — see LOCATIONS_PATH. Mac-only: the static publish
// carries no server, and Scout hides the layer there.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { id?: unknown; location?: unknown };
    if (typeof body.id !== 'string' || !body.id) return json({ ok: false, error: 'Missing id.' }, 400);
    if (body.location !== null && !isLatLon(body.location)) {
      return json({ ok: false, error: 'location must be { lat, lon } in range, or null.' }, 400);
    }
    const known = (await readManifest()).chapters.some((c) => c.photos.some((p) => p.id === body.id));
    if (!known) return json({ ok: false, error: 'No photo with that id in the archive.' }, 404);
    await setPlacedLocation(body.id, body.location);
    return json({ ok: true });
  } catch (err) {
    console.error('[scout/mine] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
