import type { APIRoute } from 'astro';
import { BUILD } from '../../lib/build-info';
import { readDevices, tidyDevices } from '../../lib/devices';
import { readManifest } from '../../lib/manifest';
import { driftBetween, stampFor } from '../../lib/publish';
import { appStatus, isLoopback, macApp, parseAsk, publishedStamp } from '../../lib/updates-server';

export const prerender = false;

// The Updates panel: which build this server serves, the Mac app's updater
// (null outside the app), the published site's build and whether it is behind
// this archive, and the devices that opened pages from this Mac.
export const GET: APIRoute = async () => {
  const now = new Date();
  const [stamp, devices] = await Promise.all([publishedStamp(), readDevices()]);
  let published = null;
  if (stamp) {
    const local = stampFor(await readManifest(), now);
    published = { builtAt: stamp.builtAt, count: stamp.count, behind: driftBetween(local, stamp, now).drifted };
  }
  return json({
    build: { version: BUILD.version, builtAt: BUILD.builtAt },
    app: appStatus(),
    published,
    devices: tidyDevices(devices, now).map((d) => ({ name: d.name, standalone: d.standalone, seenAt: d.seenAt, current: d.builtAt === BUILD.builtAt })),
  });
};

// { do: 'check' | 'install' | 'reveal', page? }: asks the Mac app (through
// desktop/server.mjs) to check, update now, or show itself in Finder. Only
// this Mac may open Finder, and only this Mac's page comes back in front.
export const POST: APIRoute = async (context) => {
  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: 'Not valid JSON' }, 400);
  }
  const ask = parseAsk(body);
  if (!ask) return json({ ok: false, error: 'Unknown request' }, 400);
  const bridge = macApp();
  if (!bridge || !appStatus()) return json({ ok: false, error: 'Not in the Mac app' }, 409);
  let address: string | null = null;
  try {
    address = context.clientAddress;
  } catch {
    /* no address from this adapter: not this Mac */
  }
  const loopback = isLoopback(address, context.request.headers);
  if (ask.do === 'reveal' && !loopback) return json({ ok: false, error: 'Only on this Mac' }, 403);
  bridge.act(ask.do, ask.page, loopback);
  return json({ ok: true }, 202);
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
