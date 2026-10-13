import type { APIRoute } from 'astro';
import { getMatch } from '../../../lib/match/session';
import { presetDownload, strengthFromParams } from '../../../lib/match/preset-download';
import { zipFiles } from '../../../lib/zip';

export const prerender = false;

// Batch Style Match: one reference (or group) solved separately against each
// of several of your photos, so a bright frame and a dark one each get the
// preset that suits them, the way Capture One's Match Look adapts per image.
// This hands them back as one .zip that Lightroom imports in a single step.
//
// ids — comma-separated match ids from /api/match/analyse, one per photo.
// Strength parameters as /api/match/preset. A match no longer loaded is left
// out and named in the X-Missing header rather than failing the batch.

export const GET: APIRoute = async ({ url }) => {
  const ids = (url.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  if (!ids.length) return json({ ok: false, error: 'No matches given.' }, 400);
  const strength = strengthFromParams(url.searchParams);
  const variant = url.searchParams.get('variant') === 'safe' ? 'safe' : 'full';

  const files: { name: string; data: string }[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    const record = getMatch(id);
    if (!record) { missing.push(id); continue; }
    const preset = await presetDownload(record, strength, variant);
    files.push({ name: preset.filename, data: preset.contents });
  }
  if (!files.length) {
    return json({ ok: false, error: 'Those comparisons are no longer loaded. Run the batch again.' }, 404);
  }
  const body = zipFiles(files);
  return new Response(body, {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(body.length),
      'content-disposition': `attachment; filename="Colour Archive presets (${files.length}).zip"`,
      ...(missing.length ? { 'x-missing': missing.join(',') } : {}),
    },
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
