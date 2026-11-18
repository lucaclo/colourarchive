import type { APIRoute } from 'astro';
import { emptyRemoved, listRemoved, trashName } from '../../../lib/removed';

export const prerender = false;

// Delete removed originals for good: { names }, as the page listed them.
// There is no "everything": a request without names deletes nothing. Only
// ever inside the trash; one bad name refuses the whole request.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { names?: unknown };
    if (!Array.isArray(body?.names)) return json({ ok: false, error: 'Not a list of names' }, 400);
    const valid = body.names.map(trashName);
    if (valid.some((n) => n === null)) return json({ ok: false, error: 'Not a removed photo' }, 400);
    const deleted = await emptyRemoved(valid as string[]);
    const { items } = await listRemoved();
    return json({ ok: true, deleted, left: items.length });
  } catch (err) {
    console.error('[removed] empty failed', err);
    return json({ ok: false, error: 'Couldn’t empty Removed' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
