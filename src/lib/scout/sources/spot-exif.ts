/**
 * Camera settings for the photographs on an opened spot sheet.
 *
 * The sequence is shared and the transport is not, exactly as in
 * `photo-client.ts`: the server route fetches with its polite User-Agent and
 * can hold a Flickr key, the static build asks Commons directly over CORS and
 * has no Flickr at all. The key, when there is one, is handed in — this file
 * never reads it, so it stays safe to bundle for the browser.
 */

import { inParallel, type JsonTransport } from './photo-client';
import {
  commonsExifUrl,
  EXIF_BATCH,
  flickrExifUrl,
  parseCommonsExif,
  parseFlickrExif,
  type ExposureSettings,
} from './exif';

/** What the sheet asks about: one photograph, by its source and id. */
export interface ExifRequest {
  source: string;
  id: string;
}

/** How many photographs a single ask may cover — about a sheet's first screenful twice over. */
export const MAX_EXIF_PHOTOS = 24;
/** Flickr is one call a photograph, so it gets a smaller share of them. */
const MAX_FLICKR_CALLS = 12;

export const exifKey = (r: ExifRequest) => `${r.source}:${r.id}`;

/** EXIF does not change. A day in memory is plenty and keeps a reopened sheet free. */
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; settings: ExposureSettings | null }>();

/**
 * Settings by `source:id`, for those that have any. A photograph with no
 * EXIF, a source that failed, or a Flickr photo without a key is simply
 * absent: the sheet shows nothing for it rather than an error.
 */
export async function collectExposure(
  requests: ExifRequest[],
  getJson: JsonTransport,
  options: { flickrKey?: string | null; cors?: boolean } = {},
): Promise<Record<string, ExposureSettings>> {
  const wanted = requests.slice(0, MAX_EXIF_PHOTOS);
  const out: Record<string, ExposureSettings> = {};
  const now = Date.now();
  const todo: ExifRequest[] = [];
  for (const r of wanted) {
    const hit = cache.get(exifKey(r));
    if (hit && now - hit.at < CACHE_MS) {
      if (hit.settings) out[exifKey(r)] = hit.settings;
    } else todo.push(r);
  }

  const remember = (r: ExifRequest, settings: ExposureSettings | null) => {
    cache.set(exifKey(r), { at: now, settings });
    if (settings) out[exifKey(r)] = settings;
  };

  const commons = todo.filter((r) => r.source === 'wikimedia');
  const flickr = options.flickrKey ? todo.filter((r) => r.source === 'flickr').slice(0, MAX_FLICKR_CALLS) : [];

  const batches: ExifRequest[][] = [];
  for (let i = 0; i < commons.length; i += EXIF_BATCH) batches.push(commons.slice(i, i + EXIF_BATCH));

  await Promise.all([
    inParallel(batches, 2, async (batch) => {
      try {
        const found = parseCommonsExif(await getJson(commonsExifUrl(batch.map((r) => r.id), { cors: options.cors })));
        for (const r of batch) remember(r, found.get(r.id) ?? null);
      } catch {
        // Not cached: a failed request is not an answer about the file.
      }
    }),
    inParallel(flickr, 4, async (r) => {
      try {
        remember(r, parseFlickrExif(await getJson(flickrExifUrl(r.id, options.flickrKey!))));
      } catch {
        /* as above */
      }
    }),
  ]);
  return out;
}
