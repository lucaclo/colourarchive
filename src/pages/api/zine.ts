import type { APIRoute } from 'astro';
import { readZine, saveZine } from '../../lib/zine-store';

export const prerender = false;

// The magazine's read and write (round 13, D2); see src/lib/zine-store.ts.
// GET: { doc (null before the first save), version, photos }. POST
// { version, doc } writes only when version names the file on disk: a stale
// tab gets 409 and the current version, and nothing is written.

export const GET: APIRoute = async () => {
  try {
    return json({ ok: true, ...(await readZine()) });
  } catch (err) {
    console.error('[zine] read failed', err);
    return json({ ok: false, error: 'Couldn’t read the zine' }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Expected a JSON object.' }, 400);
  }
  try {
    const result = await saveZine(body);
    if (result.status === 400) return json({ ok: false, error: result.error }, 400);
    if (result.status === 409) return json({ ok: false, conflict: true, error: 'Changed elsewhere', version: result.version }, 409);
    return json({ ok: true, version: result.version });
  } catch (err) {
    console.error('[zine] save failed', err);
    return json({ ok: false, error: 'Couldn’t save' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
