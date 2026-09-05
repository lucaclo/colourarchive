/**
 * Flickr as a spot source.
 *
 * Commons' peer-review tiers (`wikimedia.ts`) answer "is this a good photograph."
 * They cannot answer "is this a photograph street-photography culture actually
 * cares about" — Commons' free-licence pool skews toward historical/public-domain
 * work and CC-releasing hobbyists, and most well-known contemporary street
 * photographers simply are not on it. That culture lives on Flickr: groups like
 * In-Public and HCSP (Hardcore Street Photography), and Flickr's own
 * `interestingness` ranking, built from views/favourites/comments rather than a
 * binary review.
 *
 * Same shape as `wikimedia.ts` on purpose: pure URL builders and response
 * parsers, no I/O, so this is testable against recorded payloads exactly like
 * the Commons half.
 *
 * ## The key
 *
 * Read straight from `process.env.FLICKR_API_KEY`, server-only — same posture
 * and the same reasoning as `tide-client.ts`'s `WORLDTIDES_API_KEY`: the key
 * must never reach a browser, and a dragged pin must not turn into a request
 * storm against a keyed API. The published static build has no server to hold
 * this on, so Flickr is simply unavailable there — identical to how an unkeyed
 * WorldTides already behaves on that build. `hasFlickrKey()` is the typed,
 * honest "not configured" this codebase already uses elsewhere, rather than a
 * silent absence.
 */

import type { RawPhoto, SpotSearch } from './types';

export const FLICKR_API = 'https://api.flickr.com/services/rest';

export class FlickrError extends Error {}

/** Flickr's own ceiling; asking for more just gets clamped server-side. */
const MAX_RADIUS_KM = 32;
const MIN_RADIUS_KM = 0.1;

/** Reads the key fresh each call, same reasoning as `tide-client.ts`'s `apiKey()`:
 *  a test — or a key added mid-session in dev — should not be stuck with the
 *  first read. Exported (rather than kept private, unlike `tide-client.ts`'s
 *  version) because `photo-client.ts` needs the key itself to build the
 *  request, not just whether one exists. */
export function flickrApiKey(): string | null {
  const key = process.env.FLICKR_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export const hasFlickrKey = (): boolean => flickrApiKey() != null;

/** What Flickr's numeric `license` id means, and where its text lives —
 *  https://www.flickr.com/services/api/flickr.photos.licenses.getInfo.html.
 *  `0` ("All Rights Reserved") is recorded honestly, not dropped: the rule this
 *  whole layer is built on (see `wikimedia.ts`'s `parsePhotoDetails`) is that a
 *  *missing* author or licence gets a photograph dropped, not that a
 *  restrictive one does — a restrictive licence is still the truth. */
const FLICKR_LICENCES: Record<string, { name: string; url?: string }> = {
  '0': { name: 'All Rights Reserved' },
  '1': { name: 'CC BY-NC-SA 2.0', url: 'https://creativecommons.org/licenses/by-nc-sa/2.0/' },
  '2': { name: 'CC BY-NC 2.0', url: 'https://creativecommons.org/licenses/by-nc/2.0/' },
  '3': { name: 'CC BY-NC-ND 2.0', url: 'https://creativecommons.org/licenses/by-nc-nd/2.0/' },
  '4': { name: 'CC BY 2.0', url: 'https://creativecommons.org/licenses/by/2.0/' },
  '5': { name: 'CC BY-SA 2.0', url: 'https://creativecommons.org/licenses/by-sa/2.0/' },
  '6': { name: 'CC BY-ND 2.0', url: 'https://creativecommons.org/licenses/by-nd/2.0/' },
  '7': { name: 'No known copyright restrictions' },
  '8': { name: 'United States Government Work' },
  '9': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  '10': { name: 'Public Domain Mark 1.0', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
};

/**
 * `flickr.photos.search`, geo-scoped and sorted by interestingness.
 *
 * When `options.userId` is set (the notable-photographer path, `notable.ts`),
 * this asks for *that person's* photographs near the point rather than
 * everyone's — Flickr's documented search filters are meant to combine as one
 * query (a user id and a geo radius narrowing the same search), but that combo
 * has not been exercised against a live response here, only against Flickr's
 * own documented parameter list. Worth confirming for real the first time this
 * runs against a key — if it turns out `user_id` silently overrides the geo
 * filter instead of intersecting with it, the fallback is two calls: by user,
 * filtered client-side by distance from the returned `latitude`/`longitude`.
 */
export function flickrSearchUrl(
  query: SpotSearch,
  key: string,
  options?: { userId?: string },
): string {
  const km = Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, query.radiusM / 1000));
  const params = new URLSearchParams({
    method: 'flickr.photos.search',
    api_key: key,
    lat: String(query.centre.lat),
    lon: String(query.centre.lon),
    radius: km.toFixed(2),
    radius_units: 'km',
    sort: 'interestingness-desc',
    content_type: '1', // photos only, no screenshots/illustrations
    media: 'photos',
    per_page: String(Math.min(250, Math.max(1, query.limit))),
    extras: 'owner_name,geo,date_taken,license,url_n,url_m',
    format: 'json',
    nojsoncallback: '1',
  });
  if (options?.userId) params.set('user_id', options.userId);
  return `${FLICKR_API}/?${params}`;
}

interface FlickrPhotoEntry {
  id?: unknown;
  owner?: unknown;
  ownername?: unknown;
  title?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  license?: unknown;
  datetaken?: unknown;
  url_n?: unknown;
  width_n?: unknown;
  height_n?: unknown;
  url_m?: unknown;
  width_m?: unknown;
  height_m?: unknown;
}

/** Flickr dates arrive as "YYYY-MM-DD HH:MM:SS", local to the uploader's
 *  account — not reliably parseable to an absolute instant, so this only
 *  rejects the obviously-wrong rather than trusting the clock. */
function readDate(text: string): Date | undefined {
  if (!text) return undefined;
  const parsed = new Date(text.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return undefined;
  const year = parsed.getUTCFullYear();
  if (year < 2004 || year > 2200) return undefined; // Flickr launched in 2004
  return parsed;
}

/**
 * Turn a search response into photographs.
 *
 * Same drop rule as `parsePhotoDetails` in `wikimedia.ts`: no author, no
 * position, no image, no photograph — a licence is always present here
 * (Flickr answers unlicensed work as `0`, "All Rights Reserved," which is
 * still an answer), so unlike Commons this never drops one for a missing
 * licence field, only for a missing owner name or position.
 */
export function parseFlickrSearch(payload: unknown): RawPhoto[] {
  if (payload && typeof payload === 'object' && (payload as { stat?: unknown }).stat === 'fail') {
    const message = (payload as { message?: unknown }).message;
    throw new FlickrError(typeof message === 'string' ? message : 'Flickr search failed.');
  }
  const entries = (payload as { photos?: { photo?: unknown } })?.photos?.photo;
  if (!Array.isArray(entries)) return [];

  const photos: RawPhoto[] = [];
  for (const raw of entries as FlickrPhotoEntry[]) {
    const id = typeof raw.id === 'string' ? raw.id : '';
    const owner = typeof raw.owner === 'string' ? raw.owner : '';
    const author = typeof raw.ownername === 'string' ? raw.ownername : '';
    if (!id || !owner || !author) continue;

    const lat = Number(raw.latitude);
    const lon = Number(raw.longitude);
    // A photo with no geotag, or one whose owner has restricted location
    // visibility, comes back as exactly (0, 0) — Null Island — rather than
    // omitted. A real street photograph there is not impossible, only
    // astronomically unlikely, and treating it as "no position" is the same
    // trade every Flickr geo integration makes.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    // 320px on the long edge, same target `wikimedia.ts`'s 320 thumbnail
    // width was chosen for — falls back to the 500px size if Flickr never
    // generated the smaller one for this photo (rare, but real for very old
    // uploads).
    const thumbUrl = typeof raw.url_n === 'string' ? raw.url_n : typeof raw.url_m === 'string' ? raw.url_m : '';
    if (!thumbUrl) continue;
    const thumbWidth = Number(raw.url_n ? raw.width_n : raw.width_m) || 320;
    const thumbHeight = Number(raw.url_n ? raw.height_n : raw.height_m) || 213;

    const licenceId = typeof raw.license === 'string' ? raw.license : '0';
    const licence = FLICKR_LICENCES[licenceId] ?? { name: 'Unknown licence' };

    photos.push({
      id,
      source: 'flickr',
      at: { lat, lon },
      originUrl: `https://www.flickr.com/photos/${owner}/${id}/`,
      thumbUrl,
      thumbWidth,
      thumbHeight,
      title: typeof raw.title === 'string' && raw.title ? raw.title : 'Untitled',
      author,
      licence,
      takenAt: readDate(typeof raw.datetaken === 'string' ? raw.datetaken : ''),
      // Flickr does not expose a real capture bearing either — see `RawPhoto`.
    });
  }
  return photos;
}
