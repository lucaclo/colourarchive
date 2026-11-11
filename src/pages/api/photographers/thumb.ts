import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PHOTOGRAPHER_CACHE_DIR } from '../../../lib/paths';
import { getImage } from '../../../lib/photographers/sources';

export const prerender = false;

// A grid-sized copy of someone's picture, for hosts that only serve the
// full-size original under a signed address (Glass sends 1.7 MB each). Made
// once on the Mac and kept in the private cache; the original stays where it
// is. `getImage` refuses private addresses and anything that isn't an image.

const EDGE = 640;
const DIR = path.join(PHOTOGRAPHER_CACHE_DIR, 'thumbs');

export const GET: APIRoute = async ({ url }) => {
  const src = url.searchParams.get('u') ?? '';
  if (!/^https:\/\//i.test(src)) return new Response('Not a picture address.', { status: 400 });
  const file = path.join(DIR, `${createHash('sha1').update(src).digest('hex')}.webp`);
  let body: Buffer;
  try {
    body = await fs.readFile(file);
  } catch {
    try {
      body = await sharp(await getImage(src, 30 * 1024 * 1024))
        .rotate().resize({ width: EDGE, height: EDGE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78 }).toBuffer();
      await fs.mkdir(DIR, { recursive: true });
      await fs.writeFile(file, body);
    } catch (err) {
      return new Response(err instanceof Error ? err.message : 'That picture could not be read.', { status: 502 });
    }
  }
  return new Response(new Uint8Array(body), { headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=604800' } });
};
