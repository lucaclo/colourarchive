import type { APIRoute } from 'astro';
import { setMedium } from '../../lib/manifest';

export const prerender = false;

// Relabel a photo as film or digital (writes to photos.overrides.json).
export const POST: APIRoute = async ({ request }) => {
  try {
    const { id, medium } = await request.json();
    if (!id || (medium !== 'film' && medium !== 'digital')) {
      return json({ ok: false, error: 'Need { id, medium: "film" | "digital" }.' }, 400);
    }
    await setMedium(id, medium);
    return json({ ok: true, id, medium });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
