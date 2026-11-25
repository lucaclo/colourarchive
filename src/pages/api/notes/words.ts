import type { APIRoute } from 'astro';
import { notesKey } from '../../../lib/notes/key';
import { NotesError, writeNote } from '../../../lib/notes/serve';
import { latestNote } from '../../../lib/notes/store';
import { REASON_COPY, redact, WordsError } from '../../../lib/notes/words';

export const prerender = false;

// Notes in words (#180); see src/lib/notes/serve.ts.
// GET ?id= → { ready, note }: ready when there's a key; note is the photo's
//   latest kept note, whatever its intent, even with no key.
// POST { id, intent, fresh? } → { note }, or { error: { reason, message } }:
//   400 bad-input, 404 no-photo, 503 no-key, 502 for the service's own reasons.

const STATUS = { 'bad-input': 400, 'no-photo': 404, 'no-key': 503 } as const;
const FAILED = { reason: 'server', message: 'Unexpected error' };

export const GET: APIRoute = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  try {
    return json({ ready: notesKey() !== '', note: id ? await latestNote(id) : null });
  } catch (err) {
    console.error('[notes/words] read failed', err);
    return json({ error: FAILED }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return json({ error: { reason: 'bad-input', message: 'Intent needed' } }, 400);
  }
  try {
    const note = await writeNote({
      id: typeof body.id === 'string' ? body.id : '',
      intent: typeof body.intent === 'string' ? body.intent : '',
      fresh: body.fresh === true,
    });
    return json({ note });
  } catch (err) {
    if (err instanceof NotesError) return json({ error: { reason: err.reason, message: err.message } }, STATUS[err.reason]);
    if (err instanceof WordsError) return json({ error: { reason: err.reason, message: REASON_COPY[err.reason] } }, 502);
    console.error('[notes/words] failed', redact(String((err as Error)?.stack ?? err), notesKey()));
    return json({ error: FAILED }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
