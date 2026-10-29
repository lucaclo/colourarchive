import type { APIRoute } from 'astro';
import { readManifest } from '../../lib/manifest';
import { looksFor, photoLookRequest, type LookRequest } from '../../lib/match/looks';
import { chapterDrift } from '../../lib/match/drift';

export const prerender = false;

// Your own look (issue #144): per chapter, the photos whose grade sits
// furthest from the rest, with the reason, and the few that carry the
// chapter's look best. Measured with Style Match's look cache, so after the
// first run it costs nothing. Mac-only, like everything Match measures.
export const GET: APIRoute = async () => {
  try {
    const manifest = await readManifest();
    const photos = manifest.chapters.flatMap((c) => c.photos);
    const { signatures } = await looksFor(photos.map(photoLookRequest).filter((r): r is LookRequest => r != null));
    const byId = new Map(signatures.map((s) => [s.id, s]));
    const thumb = new Map(photos.map((p) => [p.id, p.derivatives[0]?.avif]));
    const drift = chapterDrift(manifest.chapters.map((c) => ({ key: c.key, name: c.name, ids: c.photos.map((p) => p.id) })), byId)
      .map((c) => ({ ...c, drifters: c.drifters.map((d) => ({ ...d, thumb: thumb.get(d.id) })) }));
    return json({ ok: true, chapters: drift });
  } catch (err) {
    console.error('[drift] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
