import type { APIRoute } from 'astro';
import { readStore } from '../../lib/manifest';
import { readInspStore } from '../../lib/inspiration';
import { groupOutliers, rankSimilarGroup } from '../../lib/similar';
import { oklchCss } from '../../lib/color';
import type { Photo } from '../../lib/types';

export const prerender = false;

// Given one or more references (inspiration items, or your own photos), rank
// the ARCHIVE by similarity. Returns each candidate with normalised
// composition & colour scores; the client blends them with the slider and
// shows the top N.
//
// Repeating `?ref=` is how a *group* of similarly-edited references is asked
// for — `?ref=a&ref=b&ref=c` — rather than a separate endpoint, so a single
// reference (today's every existing link) and a group are the same request
// shape, and `rankSimilarGroup` already collapses to `rankSimilar`'s exact
// numbers when there is only one.
export const GET: APIRoute = async ({ url }) => {
  try {
    const refIds = [...new Set(url.searchParams.getAll('ref').filter(Boolean))];
    if (!refIds.length) return json({ ok: false, error: 'Missing ref.' }, 400);

    const [insp, archive] = await Promise.all([readInspStore(), readStore()]);
    const byId = new Map([...insp, ...archive].map((p) => [p.id, p]));
    // Order preserved from the request, not the store — the client renders
    // the reference strip in the order the group was assembled in.
    const refs = refIds.map((id) => byId.get(id)).filter((p): p is Photo => Boolean(p));
    if (!refs.length) return json({ ok: false, error: 'Reference not found.' }, 404);

    const refIdSet = new Set(refs.map((r) => r.id));
    const candidates = archive.filter((p) => !refIdSet.has(p.id));
    const outliers = groupOutliers(refs);
    const refRows = refs.map((r) => ({
      id: r.id,
      avif: r.derivatives[0]?.avif,
      w: r.width,
      h: r.height,
      swatch: oklchCss(r.oklch),
      source: r.source ?? '',
      outlier: outliers.has(r.id),
    }));

    if (candidates.length === 0) return json({ ok: true, ready: true, refs: refRows, matches: [] });

    const embeddedRefs = refs.filter((r) => r.embedding).length;
    const embeddedCandidates = candidates.filter((p) => p.embedding).length;
    const rows = rankSimilarGroup(refs, candidates)
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
      // Composition matching needs an embedding on at least one reference and
      // at least one candidate — with a group, one un-analysed reference no
      // longer sinks the whole request the way it would have alone.
      ready: embeddedRefs > 0 && embeddedCandidates > 0,
      refEmbedded: embeddedRefs > 0,
      refs: refRows,
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
