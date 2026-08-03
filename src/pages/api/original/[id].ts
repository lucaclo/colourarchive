import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readStore } from '../../../lib/manifest';
import { PHOTOS_DIR } from '../../../lib/paths';

export const prerender = false;

// Stream the untouched original from /photos for pixel-sharp zoom in the
// lightbox. Server-only (originals never ship with the static export).
const TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  avif: 'image/avif', tif: 'image/tiff', tiff: 'image/tiff',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
};

export const GET: APIRoute = async ({ params }) => {
  const photo = (await readStore()).find((p) => p.id === params.id);
  if (!photo) return new Response('Not found', { status: 404 });
  try {
    const buf = await fs.readFile(path.join(PHOTOS_DIR, photo.filename));
    return new Response(new Uint8Array(buf), {
      headers: {
        'content-type': TYPES[photo.ext] ?? 'application/octet-stream',
        'cache-control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('Missing original', { status: 404 });
  }
};
