import type { APIRoute } from 'astro';
import { getMatch } from '../../../lib/match/session';
import { presetDownload, strengthFromParams } from '../../../lib/match/preset-download';

export const prerender = false;

// Download the preset for a match at a given strength.
//
// Generated on demand rather than at analysis time, because the strength
// slider(s) mean there is no single "the" preset — the file has to correspond
// to what the person is actually looking at when they press download.
//
// Accepts either the flat `strength` (one number for every panel) or all
// three of `light`/`colour`/`effects` (issue #41's per-panel strength) — the
// UI sends whichever mode it's in, and only one of the two shapes at a time.

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id') || '';
    const groupStrength = strengthFromParams(url.searchParams);
    const variant = url.searchParams.get('variant') === 'safe' ? 'safe' : 'full';

    const record = getMatch(id);
    if (!record) {
      return json(
        { ok: false, error: 'That comparison is no longer loaded. Run it again to download a preset.' },
        404,
      );
    }

    const chosen = await presetDownload(record, groupStrength, variant);
    return new Response(chosen.contents, {
      status: 200,
      headers: {
        'content-type': 'application/rdf+xml; charset=utf-8',
        'content-disposition': `attachment; filename="${chosen.filename}"`,
      },
    });
  } catch (err) {
    console.error('[match/preset] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
