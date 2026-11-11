import type { APIRoute } from 'astro';
import { removeInspiration } from '../../../lib/inspiration';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== 'string') return json({ ok: false, error: 'Missing id.' }, 400);
    const m = await removeInspiration(id);
    return json({ ok: true, count: m.count });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
