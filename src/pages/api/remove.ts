import type { APIRoute } from 'astro';
import { removePhoto } from '../../lib/manifest';

export const prerender = false;

// Remove a photo by id. The original is moved to photos/.trash (recoverable);
// derivatives are deleted. Local-only.
export const POST: APIRoute = async ({ request }) => {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== 'string') {
      return json({ ok: false, error: 'Missing photo id.' }, 400);
    }
    const { removed, manifest } = await removePhoto(id);
    return json({ ok: true, removed, count: manifest.count });
  } catch (err) {
    console.error('[remove] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
