import type { APIRoute } from 'astro';
import { setGenre } from '../../lib/manifest';
import { GENRES } from '../../lib/types';
import type { Genre } from '../../lib/types';

export const prerender = false;

// Relabel a photo's genre (writes to photos.overrides.json).
export const POST: APIRoute = async ({ request }) => {
  try {
    const { id, genre } = await request.json();
    if (!id || !GENRES.includes(genre as Genre)) {
      return json({ ok: false, error: `Need { id, genre: one of ${GENRES.join(' | ')} }.` }, 400);
    }
    await setGenre(id, genre as Genre);
    return json({ ok: true, id, genre });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
