import type { APIRoute } from 'astro';
import { readInspStore } from '../../../lib/inspiration';
import { readLight } from '../../../lib/light-read';
import { saveMeasures } from '../../../lib/photographers/style';

export const prerender = false;

// The light a reference was taken in (light-read.ts), for "shoot this light"
// in the board's enlarged view. The plan itself is made in the browser,
// where Scout keeps your spots.

/** Below this CLIP isn't sure enough to plan a shoot around. */
const UNSURE = 0.35;

export const GET: APIRoute = async ({ url }) => {
  const photo = (await readInspStore()).find((p) => p.id === url.searchParams.get('id'));
  if (!photo) return json({ ok: false, error: 'No such reference.' }, 404);
  try {
    const light = await readLight(photo);
    await saveMeasures();
    return json({ ok: true, light: light.share >= UNSURE ? light : null });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
