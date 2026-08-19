import type { APIRoute } from 'astro';
import { getMatch } from '../../../lib/match/session';
import { atGroupStrength, atStrength } from '../../../lib/match/adjustments';
import { buildPresetFiles } from '../../../lib/match/xmp';

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
    const variant = url.searchParams.get('variant') === 'safe' ? 'safe' : 'full';
    const clampT = (v: string | null, fallback: number) =>
      v === null ? fallback : Math.max(0, Math.min(1, Number(v)));

    const record = getMatch(id);
    if (!record) {
      return json(
        { ok: false, error: 'That comparison is no longer loaded. Run it again to download a preset.' },
        404,
      );
    }

    const hasGroups = ['light', 'colour', 'effects'].every((k) => url.searchParams.has(k));
    const flatStrength = clampT(url.searchParams.get('strength'), 0.5);
    const adj = hasGroups
      ? atGroupStrength(record.solution.restrained, record.solution.faithful, {
          light: clampT(url.searchParams.get('light'), 0.5),
          colour: clampT(url.searchParams.get('colour'), 0.5),
          effects: clampT(url.searchParams.get('effects'), 0.5),
        })
      : atStrength(record.solution.restrained, record.solution.faithful, flatStrength);
    const seedSuffix = hasGroups
      ? `L${clampT(url.searchParams.get('light'), 0.5).toFixed(2)}` +
        `C${clampT(url.searchParams.get('colour'), 0.5).toFixed(2)}` +
        `E${clampT(url.searchParams.get('effects'), 0.5).toFixed(2)}`
      : flatStrength.toFixed(2);

    // Extension first, THEN the archive's content-hash suffix — the hash is
    // never at the end of the string while ".jpg" is still attached, so doing
    // it the other way round leaves the hash in the name Lightroom displays.
    const clean = (s: string) => s.replace(/\.[^.]+$/, '').replace(/\.[0-9a-f]{8,}$/i, '');
    const name = `${clean(record.myName)} as ${clean(record.referenceName)}`.slice(0, 60);

    const files = buildPresetFiles(adj, {
      name,
      group: 'Colour Archive',
      seed: `${record.id}:${seedSuffix}`,
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
