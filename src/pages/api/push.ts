import type { APIRoute } from 'astro';
import { publicKey, sendTest, startPush, subscribe, unsubscribe } from '../../lib/push';

export const prerender = false;

// Kept-spot notifications (lib/push.ts). GET gives this Mac's public VAPID
// key. POST { action: 'subscribe', subscription, spots } adds or refreshes a
// device; { action: 'unsubscribe', endpoint } removes it; { action: 'test',
// endpoint } sends one now, to show it works.
export const GET: APIRoute = async () => {
  startPush();
  return json({ ok: true, publicKey: await publicKey() });
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { action?: string; subscription?: unknown; spots?: unknown; endpoint?: unknown };
    startPush();
    if (body.action === 'subscribe') { await subscribe(body.subscription, body.spots); return json({ ok: true }); }
    if (body.action === 'unsubscribe' && typeof body.endpoint === 'string') { await unsubscribe(body.endpoint); return json({ ok: true }); }
    if (body.action === 'test' && typeof body.endpoint === 'string') return json({ ok: await sendTest(body.endpoint) });
    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('[push] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
