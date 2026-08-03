import type { APIRoute } from 'astro';
import { getMatch } from '../../../lib/match/session';
import { atStrength } from '../../../lib/match/adjustments';
import { buildPresetFiles } from '../../../lib/match/xmp';

export const prerender = false;

// Download the preset for a match at a given strength.
//
// Generated on demand rather than at analysis time, because the strength slider
// means there is no single "the" preset — the file has to correspond to what
// the person is actually looking at when they press download.

export const GET: APIRoute = async ({ url }) => {
  try {
    const id = url.searchParams.get('id') || '';
    const strength = Math.max(0, Math.min(1, Number(url.searchParams.get('strength') ?? '0.5')));
    const variant = url.searchParams.get('variant') === 'safe' ? 'safe' : 'full';

    const record = getMatch(id);
    if (!record) {
      return json(
        { ok: false, error: 'That comparison is no longer loaded. Run it again to download a preset.' },
        404,
      );
    }

    const adj = atStrength(record.solution.restrained, record.solution.faithful, strength);
    // Extension first, THEN the archive's content-hash suffix — the hash is
    // never at the end of the string while ".jpg" is still attached, so doing
    // it the other way round leaves the hash in the name Lightroom displays.
    const clean = (s: string) => s.replace(/\.[^.]+$/, '').replace(/\.[0-9a-f]{8,}$/i, '');
    const name = `${clean(record.myName)} as ${clean(record.referenceName)}`.slice(0, 60);

    const files = buildPresetFiles(adj, {
      name,
      group: 'Colour Archive',
      seed: `${record.id}:${strength.toFixed(2)}`,
    });

    // buildPresetFiles returns the masked preset first when masks exist, and
    // always ends with the mask-free one.
    const chosen = variant === 'safe' ? files[files.length - 1] : files[0];

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
