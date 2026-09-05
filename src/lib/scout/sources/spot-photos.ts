/**
 * `fetchCommonsPhotos` plus Flickr and the curated notable-photographer list —
 * server-only, and the only thing `/api/scout/photos.ts` calls.
 *
 * **Deliberately its own file, not folded into `photo-client.ts`.** That file
 * is imported by `browser/sources.ts` too, which is bundled straight into the
 * page's client-side JavaScript for the static build — and `notable.ts` pulls
 * in `node:fs/promises`, a Node built-in with no browser equivalent. The first
 * version of this lived inside `photo-client.ts` and that import poisoned the
 * whole module for the browser bundle: the page's script crashed at load,
 * before `startScout()` ever ran, so *nothing* worked — not just the photo
 * panel, the map and the search box too, since they're downstream of the same
 * bundle. Keeping this in a separate file that only the server route imports
 * is what makes that impossible to repeat by accident.
 *
 * A Flickr key must never ship in a public bundle either way (see `flickr.ts`'s
 * header) — this file existing separately is *also* that guarantee, not just
 * the fix for the crash above.
 */

import {
  fetchCommonsPhotos,
  inParallel,
  serverGetJson,
  CACHE_MS,
  type PhotoSearch,
  type TierStatus,
} from './photo-client';
import { byStanding, parsePhotoDetails } from './wikimedia';
import { FlickrError, flickrApiKey, flickrSearchUrl, parseFlickrSearch } from './flickr';
import {
  attachNotableByAuthor,
  notableCommonsSearchUrl,
  notableFlickrSearchUrl,
  readNotablePhotographers,
  tagNotable,
} from './notable';
import { MAX_PHOTOS, type RawPhoto, type SpotSearch } from './types';

interface SpotCacheEntry {
  at: number;
  result: PhotoSearch;
}
const spotCache = new Map<string, SpotCacheEntry>();

/**
 * The notable-photographer Commons searches run unconditionally — they cost a
 * Commons request each, not a Flickr one, so they do not need a key. Only the
 * two Flickr calls (general + per-photographer) are gated on a configured key.
 */
export async function fetchSpotPhotos(query: SpotSearch): Promise<PhotoSearch> {
  const cacheKey = `${query.centre.lat.toFixed(4)},${query.centre.lon.toFixed(4)},${Math.round(query.radiusM)},${query.limit}`;
  const hit = spotCache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const commons = await fetchCommonsPhotos(query);
  const photographers = await readNotablePhotographers();
  const key = flickrApiKey();

  // One row per named photographer would swamp the "N of M sources answered"
  // line once the list has more than a couple of names in it — reported as a
  // single 'notable' source instead, `ok` unless every one of them failed.
  let notableOk = true;
  const notableResults = photographers.length
    ? await inParallel(photographers, 4, async (photographer) => {
        try {
          const payload = await serverGetJson(notableCommonsSearchUrl(query, photographer));
          return tagNotable(parsePhotoDetails(payload), photographer);
        } catch {
          return null; // this one person's search failed; tallied below
        }
      })
    : [];
  const notablePhotos: RawPhoto[] = [];
  for (const found of notableResults) {
    if (found === null) notableOk = false;
    else notablePhotos.push(...found);
  }

  const tiers: TierStatus[] = [...commons.tiers];
  if (photographers.length) tiers.push({ accolade: 'notable', ok: notableOk });

  const flickrPhotos: RawPhoto[] = [];
  if (!key) {
    tiers.push({ accolade: 'flickr', ok: false, needsKey: true });
  } else {
    let flickrOk = true;
    try {
      const payload = await serverGetJson(flickrSearchUrl(query, key));
      flickrPhotos.push(...parseFlickrSearch(payload));
    } catch (err) {
      flickrOk = false;
      if (!(err instanceof FlickrError)) console.error('[scout/photos] Flickr search failed', err);
    }

    const flickrPhotographers = photographers.filter((p) => p.flickrNsid);
    if (flickrPhotographers.length) {
      const found = await inParallel(flickrPhotographers, 4, async (photographer) => {
        const url = notableFlickrSearchUrl(query, photographer, key);
        if (!url) return [];
        try {
          return tagNotable(parseFlickrSearch(await serverGetJson(url)), photographer);
        } catch {
          return [];
        }
      });
      for (const batch of found) flickrPhotos.push(...batch);
    }

    tiers.push({ accolade: 'flickr', ok: flickrOk });
  }

  // Union everything, matching a listed name against any *general*-search
  // result too (see `attachNotableByAuthor`), then dedupe: the same
  // photograph can legitimately surface from more than one search — a
  // photographer's own Commons category and an accolade tier, most often —
  // and the notable-tagged copy wins where both exist.
  const merged = new Map<string, RawPhoto>();
  for (const photo of attachNotableByAuthor(
    [...commons.photos, ...notablePhotos, ...flickrPhotos],
    photographers,
  )) {
    const dedupeKey = `${photo.source}:${photo.id}`;
    const existing = merged.get(dedupeKey);
    if (!existing || (photo.notable && !existing.notable)) merged.set(dedupeKey, photo);
  }

  const result: PhotoSearch = {
    photos: [...merged.values()].sort(byStanding).slice(0, MAX_PHOTOS),
    tiers,
  };
  if (tiers.some((t) => t.ok)) spotCache.set(cacheKey, { at: Date.now(), result });
  return result;
}
