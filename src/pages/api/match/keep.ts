import type { APIRoute } from 'astro';
import { keepMatch } from '../../../lib/match/session';

export const prerender = false;

// Pin a comparison so it survives eviction and a restart. Comparisons are
// ephemeral by default; this is the explicit "keep" action.

export const POST: APIRoute = async ({ request }) => {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== 'string') return json({ ok: false, error: 'Missing id.' }, 400);
    const record = await keepMatch(id);
    if (!record) {
      return json({ ok: false, error: 'That comparison is no longer loaded.' }, 404);
    }
    return json({ ok: true, id: record.id, kept: true });
  } catch (err) {
    console.error('[match/keep] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
