import type { APIRoute } from 'astro';
import { readStore } from '../../lib/manifest';

export const prerender = false;

// A light manifest for pickers elsewhere on the site that need to browse the
// archive by id rather than by URL — Scout's "attach an archive photo" when
// reconstructing a past visit (issue #75) is the first of these. Only photos
// carrying a captured date are offered: without one there is nothing for a
// picker built around "fill in the date this was taken" to fill in.
// `?all=1` includes the undated ones too, for Style Match's reference picker
// (issue #144), which is about the look, not the date.
export const GET: APIRoute = async ({ url }) => {
  try {
    const all = url.searchParams.get('all') === '1';
    const archive = await readStore();
    const photos = archive
      .filter((p) => all || p.exif.capturedAt)
      .map((p) => ({
        id: p.id,
        avif: p.derivatives[0]?.avif,
        filename: p.filename,
        capturedAt: p.exif.capturedAt,
        location: p.exif.location ?? null,
      }))
      .sort((a, b) => ((a.capturedAt ?? '') < (b.capturedAt ?? '') ? 1 : (a.capturedAt ?? '') > (b.capturedAt ?? '') ? -1 : 0));
    return json({ ok: true, photos });
  } catch (err) {
    console.error('[photos] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
