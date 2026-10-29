import type { APIRoute } from 'astro';
import { inboxDir, readInboxLog, scanInbox, startInbox } from '../../lib/inbox';

export const prerender = false;

// The iCloud inbox (lib/inbox.ts). GET makes sure the scan loop is running in
// this server — the Mac app's server calls it once it is listening, so the
// inbox is read on launch with no window open — and says what it last did.
// POST scans now.

export const GET: APIRoute = async () => {
  startInbox();
  return json({ ok: true, dir: inboxDir(), ...(await readInboxLog()) });
};

export const POST: APIRoute = async () => {
  startInbox();
  return json({ ok: true, dir: inboxDir(), ...(await scanInbox()) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
