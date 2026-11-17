import type { APIRoute } from 'astro';
import { listRemoved } from '../../../lib/removed';

export const prerender = false;

// The originals in the trash (R13-16), newest first, and their total size.
export const GET: APIRoute = async () => {
  try {
    const { items, bytes } = await listRemoved();
    return json({ ok: true, items, bytes });
  } catch (err) {
    console.error('[removed] list failed', err);
    return json({ ok: false, error: 'Couldn’t read Removed' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
