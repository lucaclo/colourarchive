import type { APIRoute } from 'astro';
import { previewOf, trashName } from '../../../lib/removed';

export const prerender = false;

// A small JPEG of one removed original, for the Removed list.
export const GET: APIRoute = async ({ url }) => {
  const name = trashName(url.searchParams.get('name'));
  if (!name) return new Response(null, { status: 400 });
  try {
    const jpeg = await previewOf(name);
    if (!jpeg) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(jpeg), {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600' },
    });
  } catch (err) {
    // A format the image library can't draw: the list shows an empty tile.
    console.warn('[removed] no preview for', name, err instanceof Error ? err.message : err);
    return new Response(null, { status: 415 });
  }
};
