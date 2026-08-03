import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MATCH_CACHE_DIR } from '../../../../lib/paths';

export const prerender = false;

// Serves preview assets (the photo, the packed mask texture, the reference
// thumbnail) for a match.
//
// These deliberately do NOT live in public/: the dev server does not reliably
// serve files created after it booted, and public/ is copied wholesale into the
// production build, which would publish every comparison anyone had ever run.

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.avif': 'image/avif',
};

export const GET: APIRoute = async ({ params }) => {
  const rel = params.file ?? '';

  // The path comes from the URL, so it is untrusted. Resolve it and confirm it
  // stayed inside the cache directory before touching the filesystem.
  const resolved = path.resolve(MATCH_CACHE_DIR, rel);
  const root = path.resolve(MATCH_CACHE_DIR);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return new Response('Not found', { status: 404 });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (!TYPES[ext]) return new Response('Not found', { status: 404 });

  try {
    const data = await fs.readFile(resolved);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': TYPES[ext],
        // Content is immutable: every asset path contains the match id, which
        // is a hash of both photos and the baseline.
        'cache-control': 'private, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
