import type { APIRoute } from 'astro';
import { connectInstagram, disconnectInstagram, readInstagram } from '../../../lib/photographers/instagram-api';

export const prerender = false;

// Your own Instagram connection (lib/photographers/instagram-api.ts): whether
// it's there, making it, and removing it. The token and secret never come
// back out of this endpoint.

export const GET: APIRoute = async () => {
  const c = await readInstagram();
  return json({ ok: true, connected: Boolean(c), username: c?.username ?? null, expiresAt: c?.expiresAt ?? null });
};

export const POST: APIRoute = async ({ request }) => {
  let body: { appId?: string; appSecret?: string; token?: string };
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Expected JSON.' }, 400); }
  if (!body.appId?.trim() || !body.appSecret?.trim() || !body.token?.trim()) {
    return json({ ok: false, error: 'All three are needed: app ID, app secret and the token.' }, 400);
  }
  try {
    const c = await connectInstagram(body.appId, body.appSecret, body.token);
    return json({ ok: true, connected: true, username: c.username, expiresAt: c.expiresAt });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
};

export const DELETE: APIRoute = async () => {
  await disconnectInstagram();
  return json({ ok: true, connected: false });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
