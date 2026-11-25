import type { APIRoute } from 'astro';
import { isLoopback, macApp } from '../../../lib/updates-server';

export const prerender = false;

// A picture of the Mac app's window as it is now, for the feedback sheet to
// start with (components/Feedback.astro asks before it opens, so the sheet
// isn't in it). Only inside the Mac app, and only asked from this Mac: a phone
// coming in through the gate gets nothing of the Mac's screen. A POST, so the
// origin check in src/middleware.ts applies.
export const POST: APIRoute = async (context) => {
  const bridge = macApp();
  if (!bridge?.capture) return new Response(null, { status: 409 });
  let address: string | null = null;
  try {
    address = context.clientAddress;
  } catch {
    /* no address from this adapter: not this Mac */
  }
  if (!isLoopback(address, context.request.headers)) return new Response(null, { status: 403 });
  const jpeg = await bridge.capture().catch(() => null);
  if (!jpeg || !jpeg.byteLength) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(jpeg), { status: 200, headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
};
