import type { APIRoute } from 'astro';
import { readPhoto, savePhoto, isPhotoKey } from '../../../../lib/zine-store';

export const prerender = false;

// A photo added to the zine from a device (round 13, D2): PUT stores the JPEG
// the page made, GET serves it back. Keys are made once per photo and never
// reused, so a GET can be cached for good.

export const GET: APIRoute = async ({ params }) => {
  const bytes = await readPhoto(params.key ?? '');
  if (!bytes) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=31536000, immutable' },
  });
};

export const PUT: APIRoute = async ({ params, request }) => {
  const key = params.key ?? '';
  if (!isPhotoKey(key)) return json({ ok: false, error: 'Bad photo key.' }, 400);
  try {
    const result = await savePhoto(key, new Uint8Array(await request.arrayBuffer()));
    return result.ok ? json({ ok: true }) : json(result, 400);
  } catch (err) {
    console.error('[zine] photo save failed', err);
    return json({ ok: false, error: 'Couldn’t save the photo' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
