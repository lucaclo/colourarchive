import type { APIRoute } from 'astro';
import { readManifest } from '../../lib/manifest';
import { readBookCuration, writeBookCuration, orderedChaptersWithExclusions, type BookCuration } from '../../lib/book';

export const prerender = false;

// The book editor's own read/write — issue #82. GET returns every chapter's
// photos in curated order (excluded ones included, marked, so the editor can
// offer them back in rather than only ever removing) alongside the manifest's
// own chapters; POST replaces the curation wholesale, since the editor always
// holds the full current state client-side rather than a diff.

export const GET: APIRoute = async () => {
  try {
    const [manifest, curation] = await Promise.all([readManifest(), readBookCuration()]);
    const chapters = orderedChaptersWithExclusions(manifest.chapters, curation).map((ch) => ({
      key: ch.key,
      name: ch.name,
      photos: ch.photos.map((p) => ({
        id: p.id,
        avif: p.derivatives[0]?.avif,
        filename: p.filename,
        excluded: p.excluded,
      })),
    }));

    return json({ ok: true, chapters });
  } catch (err) {
    console.error('[book] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { chapters?: Record<string, unknown>; excluded?: unknown };
    const curation: BookCuration = {};

    if (body.chapters && typeof body.chapters === 'object') {
      const chapters: Record<string, string[]> = {};
      for (const [key, order] of Object.entries(body.chapters)) {
        if (Array.isArray(order) && order.every((id) => typeof id === 'string')) chapters[key] = order;
      }
      if (Object.keys(chapters).length) curation.chapters = chapters;
    }
    if (Array.isArray(body.excluded) && body.excluded.every((id) => typeof id === 'string')) {
      curation.excluded = body.excluded;
    }

    await writeBookCuration(curation);
    return json({ ok: true });
  } catch (err) {
    console.error('[book] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
