import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { readManifest, readStore } from '../../../lib/manifest';
import { readBookCuration, curatedChapters } from '../../../lib/book';
import { buildWorkPrints, WORKPRINTS_LIST } from '../../../lib/floor/workprints';
import { readFloor } from '../../../lib/floor/read';

export const prerender = false;

// Sequence on the floor (issue #147).
// POST ?make=1 builds the work-print PDF of the book as saved (16 to an A4,
// in book order, numbered) and returns its link.
// POST with a photo (multipart, field "photo") reads the floor: the order
// the prints were laid in, matched against the photos last printed.
export const POST: APIRoute = async ({ request, url }) => {
  try {
    const [manifest, curation, store] = await Promise.all([readManifest(), readBookCuration(), readStore()]);
    const inBook = curatedChapters(manifest.chapters, curation).flatMap((c) => c.photos);
    if (url.searchParams.get('make') === '1') {
      const { name, pages } = await buildWorkPrints(inBook.map((p, i) => ({ id: p.id, filename: p.filename, code: String(i + 1).padStart(3, '0') })));
      return json({ ok: true, href: `/api/book/pdf?file=${encodeURIComponent(name)}`, pages, count: inBook.length });
    }
    const form = await request.formData();
    const photo = form.get('photo');
    if (!(photo instanceof File)) return json({ ok: false, error: 'No photo received.' }, 400);
    let printed: string[] = inBook.map((p) => p.id);
    try { printed = JSON.parse(await fs.readFile(WORKPRINTS_LIST(), 'utf8')).ids; } catch { /* never printed here: the whole book */ }
    const byId = new Map(store.map((p) => [p.id, p]));
    const candidates = printed.map((id) => byId.get(id)).filter((p) => p?.embedding).map((p) => ({ id: p!.id, embedding: p!.embedding! }));
    const reading = await readFloor(Buffer.from(await photo.arrayBuffer()), candidates);
    return json({ ok: true, prints: reading.prints.map(({ id, score, row, pairedWithNext }) => ({ id, score, row, pairedWithNext })) });
  } catch (err) {
    console.error('[book/floor] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
