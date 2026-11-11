import type { APIRoute } from 'astro';
import { addInspiration } from '../../../lib/inspiration';
import { getImage } from '../../../lib/photographers/sources';
import { cachedWork, updatePhotographers } from '../../../lib/photographers/store';

export const prerender = false;

// Pin one of a photographer's public pictures to the board. Only a picture
// their feed actually listed can be pinned — the address comes from the
// cache, never from the request — and it arrives credited, with the post it
// came from as its source. Only what you pin is kept; the rest stays on
// their site, shown by its own address.

export const POST: APIRoute = async ({ request }) => {
  let id = '', key = '';
  try { ({ id, key } = await request.json()); } catch { return json({ ok: false, error: 'Expected JSON.' }, 400); }
  const item = (await cachedWork(id)).find((w) => w.key === key);
  if (!item) return json({ ok: false, error: 'That picture is no longer in their feed.' }, 404);

  let buf: Buffer;
  try { buf = await getImage(item.full); } catch {
    try { buf = await getImage(item.thumb); } catch (err) { return json({ ok: false, error: (err as Error).message }, 502); }
  }
  const name = decodeURIComponent(new URL(item.full).pathname.split('/').pop() || 'reference') || 'reference';
  try {
    const { photo, id: refId, existed } = await addInspiration(buf, name, item.url);
    await updatePhotographers((f) => {
      f.credits[photo?.id ?? refId] = id;
      (f.marks[id] ??= {})[key] = 'pinned';
    });
    return json({ ok: true, refId: photo?.id ?? refId, existed });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
