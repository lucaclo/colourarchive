import type { APIRoute } from 'astro';
import { serverGetJson } from '../../../lib/scout/sources/photo-client';
import { flickrApiKey } from '../../../lib/scout/sources/flickr';
import { collectExposure, MAX_EXIF_PHOTOS, type ExifRequest } from '../../../lib/scout/sources/spot-exif';

export const prerender = false;

// Camera settings for the photographs on an opened spot sheet. `ids` is a
// comma list of `source:id`. Thin, like the other scout routes — the batching,
// the cache and the Flickr key handling live in the library.
export const GET: APIRoute = async ({ url }) => {
  const requests: ExifRequest[] = [];
  for (const part of (url.searchParams.get('ids') ?? '').split(',').slice(0, MAX_EXIF_PHOTOS)) {
    const at = part.indexOf(':');
    const source = part.slice(0, at);
    const id = part.slice(at + 1);
    // Ids are numeric on both sources; anything else is not a photograph this
    // page could have shown, and is not passed on to anybody's API.
    if ((source === 'wikimedia' || source === 'flickr') && /^\d{1,20}$/.test(id)) requests.push({ source, id });
  }
  if (!requests.length) return json({ ok: false, error: 'No photographs asked about.' }, 400);

  const settings = await collectExposure(requests, serverGetJson, { flickrKey: flickrApiKey() });
  return json({ ok: true, settings }, 200, { 'cache-control': 'public, max-age=86400' });
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
