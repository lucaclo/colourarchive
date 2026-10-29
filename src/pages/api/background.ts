import type { APIRoute } from 'astro';
import { startBackground } from '../../lib/background';

export const prerender = false;

// Starts the server's own loops (lib/background.ts). The Mac app's server
// calls this once it is listening, so they run with no window open.
export const GET: APIRoute = () => {
  startBackground();
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
};
