import type { APIRoute } from 'astro';
import { listRemoved, restoreRemoved, trashName } from '../../../lib/removed';

export const prerender = false;

// Put one removed original back into the archive: { name } as listed.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { name?: unknown };
    const name = trashName(body?.name);
    if (!name) return json({ ok: false, error: 'Not a removed photo' }, 400);
    const outcome = await restoreRemoved(name);
    if (outcome.status === 'missing') return json({ ok: false, error: 'Not in Removed' }, 404);
    if (outcome.status === 'failed') return json({ ok: false, error: outcome.error }, 422);
    const { items } = await listRemoved();
    return json({ ok: true, status: outcome.status, result: outcome.result, left: items.length });
  } catch (err) {
    console.error('[removed] restore failed', err);
    return json({ ok: false, error: 'Couldn’t restore it' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
