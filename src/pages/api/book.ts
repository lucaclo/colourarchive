import type { APIRoute } from 'astro';
import { readManifest } from '../../lib/manifest';
import { readBookState, saveBookCuration, orderedChaptersWithExclusions } from '../../lib/book';

export const prerender = false;

// The book editor's own read/write — issue #82. GET returns every chapter's
// photos in curated order (excluded ones included, marked, so the editor can
// offer them back in rather than only ever removing) alongside the manifest's
// own chapters, and the file's version. POST merges a save into the file
// (fields absent keep their saved value) only when it names the version on
// disk: a stale tab gets 409 and the current version, and nothing is written.
// See saveBookCuration in src/lib/book.ts.

export const GET: APIRoute = async () => {
  try {
    const [manifest, { curation, version }] = await Promise.all([readManifest(), readBookState()]);
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

    return json({ ok: true, chapters, version });
  } catch (err) {
    console.error('[book] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Expected a JSON object.' }, 400);
  }
  try {
    const result = await saveBookCuration(body);
    if (result.status === 400) return json({ ok: false, error: result.error }, 400);
    if (result.status === 409) return json({ ok: false, conflict: true, error: 'Changed elsewhere', version: result.version }, 409);
    return json({ ok: true, version: result.version });
  } catch (err) {
    console.error('[book] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
