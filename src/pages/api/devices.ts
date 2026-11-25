import type { APIRoute } from 'astro';
import { isMacApp, parseReport, rememberDevice } from '../../lib/devices';

export const prerender = false;

// A page served by this Mac says which device it is and which build it has
// (src/lib/devices.ts), for the Updates panel. The Mac app's own window is
// answered and not kept.
export const POST: APIRoute = async ({ request }) => {
  if (isMacApp(request.headers.get('user-agent'))) return new Response(null, { status: 204 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Not valid JSON' }, 400);
  }
  const report = parseReport(body);
  if (!report) return json({ ok: false, error: 'Not a device' }, 400);
  await rememberDevice(report);
  return new Response(null, { status: 204 });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
