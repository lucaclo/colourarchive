import type { APIRoute } from 'astro';
import { readManifest } from '../../../lib/manifest';
import { buildSharedFeed, setShared, shareState } from '../../../lib/shared-photos';

export const prerender = false;

// Sharing photos to Scout's hotspots, on the Mac. GET: which are shared,
// which have a place, and the live feed (the published site has the same
// feed baked in at /scout-shared.json). POST { id, shared }: share or stop.
export const GET: APIRoute = async () => {
  try {
    const manifest = await readManifest();
    const [state, feed] = await Promise.all([shareState(manifest), buildSharedFeed(manifest)]);
    return json({ ok: true, ...state, feed });
  } catch (err) {
    console.error('[scout/shared] read failed', err);
    return json({ ok: false, error: 'Couldn’t read the shared photos.' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { id?: unknown; shared?: unknown };
    if (typeof body.id !== 'string' || typeof body.shared !== 'boolean') {
      return json({ ok: false, error: 'Needs { id, shared }.' }, 400);
    }
    const manifest = await readManifest();
    if (!manifest.chapters.some((c) => c.photos.some((p) => p.id === body.id))) {
      return json({ ok: false, error: 'No photo with that id.' }, 404);
    }
    if (body.shared) {
      const { located } = await shareState(manifest);
      // A hotspot is a place: a photo without one has nowhere to appear.
      if (!located.includes(body.id)) return json({ ok: false, needsPlace: true, error: 'It needs a place first.' }, 409);
    }
    await setShared(body.id, body.shared);
    return json({ ok: true, shared: body.shared });
  } catch (err) {
    console.error('[scout/shared] save failed', err);
    return json({ ok: false, error: 'Couldn’t save that.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
