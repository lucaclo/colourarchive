import type { APIRoute } from 'astro';
import { readStore } from '../../lib/manifest';
import { readInspStore } from '../../lib/inspiration';
import { rankSimilar } from '../../lib/similar';
import { oklchCss } from '../../lib/color';

export const prerender = false;

// Given a reference (an inspiration item, or one of your own photos), rank the
// ARCHIVE by similarity. Returns each candidate with normalised composition &
// colour scores; the client blends them with the slider and shows the top N.
export const GET: APIRoute = async ({ url }) => {
  try {
    const refId = url.searchParams.get('ref');
    if (!refId) return json({ ok: false, error: 'Missing ref.' }, 400);

    const [insp, archive] = await Promise.all([readInspStore(), readStore()]);
    const ref = insp.find((p) => p.id === refId) || archive.find((p) => p.id === refId);
    if (!ref) return json({ ok: false, error: 'Reference not found.' }, 404);

    const candidates = archive.filter((p) => p.id !== refId);
    if (candidates.length === 0) return json({ ok: true, ready: true, matches: [] });

    const embedded = candidates.filter((p) => p.embedding).length;
    const rows = rankSimilar(ref, candidates)
      .map((r) => ({
        id: r.photo.id,
        avif: r.photo.derivatives[0]?.avif,
        w: r.photo.width,
        h: r.photo.height,
        swatch: oklchCss(r.photo.oklch),
        comp: Math.round(r.comp * 1000) / 1000,
        col: Math.round(r.col * 1000) / 1000,
      }));

    return json({
      ok: true,
      // Composition matching needs embeddings on both sides.
      ready: Boolean(ref.embedding) && embedded > 0,
      refEmbedded: Boolean(ref.embedding),
      candidateCount: candidates.length,
      matches: rows,
    });
  } catch (err) {
    console.error('[similar] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
