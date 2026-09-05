import type { APIRoute } from 'astro';
import { readNotes, setNote } from '../../lib/notes';

export const prerender = false;

// GET returns every note, keyed by photo id, for the book editor to attach
// to cells; POST sets (or clears, with empty text) one. No bulk replace —
// unlike book.ts's curation, the editor never holds every note client-side
// at once, so there is nothing to diff against and a per-note write is the
// honest shape of the request.

export const GET: APIRoute = async () => {
  try {
    return json({ ok: true, notes: await readNotes() });
  } catch (err) {
    console.error('[notes] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { id?: unknown; text?: unknown };
    if (typeof body.id !== 'string' || !body.id) return json({ ok: false, error: 'Missing id.' }, 400);
    if (typeof body.text !== 'string') return json({ ok: false, error: 'Missing text.' }, 400);
    await setNote(body.id, body.text);
    return json({ ok: true });
  } catch (err) {
    console.error('[notes] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
