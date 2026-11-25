import type { APIRoute } from 'astro';
import { BUILD } from '../../lib/build-info';

export const prerender = false;

// Which build this server serves now (build-info.ts), so a page left open can
// tell it is older. Under /api, which the service worker never caches.
export const GET: APIRoute = () =>
  new Response(JSON.stringify({ version: BUILD.version, builtAt: BUILD.builtAt }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
