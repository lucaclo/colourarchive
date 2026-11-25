import type { APIRoute } from 'astro';
import { isMark, setMark } from '../../../lib/notes/store';

export const prerender = false;

// Useful / Not useful on a kept note in words (#180), or null to clear it.
// POST { id, key, mark } → { ok: true }; 404 when that note isn't kept for the
// photo, 400 for anything else wrong with the body.

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    const raw: unknown = await request.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) body = raw as Record<string, unknown>;
  } catch {
    /* answered as bad input below */
  }
  const { id, key, mark } = body;
  if (typeof id !== 'string' || !id || typeof key !== 'string' || !key || !isMark(mark)) {
    return json({ error: { reason: 'bad-input', message: 'Not a mark' } }, 400);
  }
  try {
    if (!(await setMark(id, key, mark))) return json({ error: { reason: 'no-note', message: 'Note not found' } }, 404);
    return json({ ok: true });
  } catch (err) {
    console.error('[notes/mark] failed', err);
    return json({ error: { reason: 'server', message: 'Unexpected error' } }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
