import type { APIRoute } from 'astro';
import { setChapter } from '../../lib/manifest';
import { isChapterBase } from '../../lib/borderline';
import { baseKeyOf } from '../../lib/color';

export const prerender = false;

// File photos under a chapter by hand (writes to photos.overrides.json), or
// `chapter: null` to hand them back to the automatic classification.
//
// Replies with where each photo actually landed, not just the base it was
// given: the band split and the tiny-chapter fold both run after the move, so
// "moved to Orange" can honestly end up in Deep Orange — or folded into a
// neighbour — and the caller has to be able to say which.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const ids: unknown = body.ids ?? (body.id ? [body.id] : null);
    const chapter: unknown = body.chapter;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
      return json({ ok: false, error: 'Need { id } or { ids: [...] }.' }, 400);
    }
    if (chapter !== null && (typeof chapter !== 'string' || !isChapterBase(chapter))) {
      return json({ ok: false, error: 'Need { chapter: a base chapter key, or null for automatic }.' }, 400);
    }
    const manifest = await setChapter(ids as string[], chapter as string | null);
    const wanted = new Set(ids as string[]);
    const landed: Record<string, { key: string; name: string; base: string; auto: boolean }> = {};
    for (const ch of manifest.chapters) {
      for (const p of ch.photos) {
        if (wanted.has(p.id)) landed[p.id] = { key: ch.key, name: ch.name, base: p.chapter, auto: p.chapter === baseKeyOf(p.autoChapter) };
      }
    }
    return json({ ok: true, landed });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
