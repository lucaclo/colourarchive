import type { APIRoute } from 'astro';
import { readManifest } from '../lib/manifest';
import { buildSharedFeed } from '../lib/shared-photos';

// The photos shared to Scout's hotspots, with their places, written into the
// built site so the published Scout shows them to everyone. Prerendered: the
// feed is fixed at publish, like the photographs it points at.
export const prerender = true;

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await buildSharedFeed(await readManifest())), {
    headers: { 'content-type': 'application/json' },
  });
