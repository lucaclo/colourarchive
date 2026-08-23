import type { APIRoute } from 'astro';
import { readStore } from '../../lib/manifest';
import { clipEmbedText } from '../../lib/clip';
import { rankByTextQuery } from '../../lib/textSearch';
import { oklchCss } from '../../lib/color';

export const prerender = false;

// Free-text search over the archive: embed the query with CLIP's text encoder
// (server-side, per request — cheap relative to the image side, which is
// precomputed once at ingest) and rank every photo's stored `clipEmbedding`
// against it. Same row shape as /api/similar, so the client can reuse one
// renderer for both.
export const GET: APIRoute = async ({ url }) => {
  try {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return json({ ok: false, error: 'Missing q.' }, 400);

    const archive = await readStore();
    const embeddedCount = archive.filter((p) => p.clipEmbedding).length;
    // Refuse rather than rank nonsense: with nothing embedded, "closest match"
    // is meaningless — every candidate would tie, or worse, get silently
    // dropped by rankByTextQuery, and either way the client has no way to
    // tell "no matches" apart from "search isn't wired up yet".
    if (embeddedCount === 0) {
      return json({ ok: true, ready: false, matches: [] });
    }

    const queryEmbedding = await clipEmbedText(q).catch((e) => {
      console.error('[search] query embedding failed', e);
      return undefined;
    });
    if (!queryEmbedding) return json({ ok: false, error: 'Could not embed query.' }, 500);

    const rows = rankByTextQuery(queryEmbedding, archive).map((r) => ({
      id: r.photo.id,
      avif: r.photo.derivatives[0]?.avif,
      w: r.photo.width,
      h: r.photo.height,
      swatch: oklchCss(r.photo.oklch),
      score: Math.round(r.score * 1000) / 1000,
    }));

    return json({ ok: true, ready: true, candidateCount: embeddedCount, matches: rows });
  } catch (err) {
    console.error('[search] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
