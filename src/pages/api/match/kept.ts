import type { APIRoute } from 'astro';
import { getMatch, listKeptMatches, unkeepMatch } from '../../../lib/match/session';

export const prerender = false;

// The Style Match "library" — every comparison you've explicitly kept
// (POST /api/match/keep), reachable again after you've navigated away or the
// server has restarted.
//
// GET with no `id` lists them as lightweight summaries (a thumbnail each, not
// the full measurement payload — the board renders a grid of these before any
// one report is opened). GET with `id` returns one full record, in the exact
// shape /api/match/analyse's response takes, so the client can hand it
// straight to the same `showResult()` that a fresh analysis uses — reopening
// a kept report is not a second code path.

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    if (id) {
      const record = getMatch(id);
      if (!record || !record.kept) {
        return json({ ok: false, error: 'That kept comparison could not be found.' }, 404);
      }
      return json({
        ok: true,
        id: record.id,
        references: record.references,
        reference: record.reference,
        mine: record.mine,
        solution: record.solution,
        preview: record.preview,
        maskChannels: record.maskChannels,
        referenceName: record.referenceName,
        myName: record.myName,
        kept: record.kept,
        referenceCount: record.referenceCount,
        referenceIds: record.referenceIds,
        outlierIds: record.outlierIds,
      });
    }

    const items = listKeptMatches().map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      referenceName: r.referenceName,
      myName: r.myName,
      referenceCount: r.referenceCount,
      previewUrl: r.preview.photo,
      referencePreviewUrl: r.references[0]?.previewUrl ?? null,
    }));
    return json({ ok: true, items });
  } catch (err) {
    console.error('[match/kept] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  try {
    const { id } = await request.json();
    if (!id || typeof id !== 'string') return json({ ok: false, error: 'Missing id.' }, 400);
    const removed = await unkeepMatch(id);
    if (!removed) return json({ ok: false, error: 'That comparison was not kept.' }, 404);
    return json({ ok: true });
  } catch (err) {
    console.error('[match/kept] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
