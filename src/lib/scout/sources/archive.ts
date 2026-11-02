/**
 * The archive's own shared photographs as a hotspot source.
 *
 * A photo shared from the lightbox goes out with the published site, in
 * `/scout-shared.json`, with its place, so anyone using that Scout finds it
 * among the hotspots, credited to Colour Archive like any other photographer.
 * On the Mac the same feed comes live from `/api/scout/shared`.
 *
 * Browser-safe and pure: the feed is parsed and checked here, never trusted,
 * and turned into the same `RawPhoto` every other adapter produces, so the
 * clustering, the ranking and the photo sheet need nothing new.
 */

import { distance, type LatLon } from '../geo';
import type { RawPhoto } from './types';

export const ARCHIVE_SOURCE = 'archive';
export const ARCHIVE_CREDIT = 'Colour Archive';

export interface SharedPhoto {
  id: string;
  lat: number;
  lon: number;
  /** A small derivative, site-relative. */
  thumb: string;
  thumbWidth: number;
  thumbHeight: number;
  title: string;
  /** True UTC when the file knows its offset; omitted otherwise. */
  takenAt?: string;
}

export interface SharedFeed {
  credit: string;
  photos: SharedPhoto[];
}

const isFiniteIn = (v: unknown, lim: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

/** Read a feed, keeping only well-formed photos with a real place. */
export function parseSharedFeed(value: unknown): SharedFeed {
  const raw = value as { credit?: unknown; photos?: unknown } | null;
  const credit = typeof raw?.credit === 'string' && raw.credit.trim() ? raw.credit.trim().slice(0, 80) : ARCHIVE_CREDIT;
  const photos = Array.isArray(raw?.photos)
    ? raw.photos.filter(
        (p): p is SharedPhoto =>
          !!p &&
          typeof p.id === 'string' &&
          /^[\w-]{1,64}$/.test(p.id) &&
          isFiniteIn(p.lat, 90) &&
          isFiniteIn(p.lon, 180) &&
          typeof p.thumb === 'string' &&
          p.thumb.startsWith('/') &&
          typeof p.title === 'string',
      )
    : [];
  return { credit, photos };
}

/** The shared photos within `radiusM` of `centre`, as hotspot photographs. */
export function sharedNear(feed: SharedFeed, centre: LatLon, radiusM: number): RawPhoto[] {
  return feed.photos
    .filter((p) => distance(centre, p) <= radiusM)
    .map((p) => {
      const taken = p.takenAt ? new Date(p.takenAt) : undefined;
      return {
        id: p.id,
        source: ARCHIVE_SOURCE,
        at: { lat: p.lat, lon: p.lon },
        originUrl: `/#photo=${p.id}`,
        thumbUrl: p.thumb,
        thumbWidth: p.thumbWidth || 480,
        thumbHeight: p.thumbHeight || 320,
        title: p.title,
        author: feed.credit,
        licence: { name: 'All rights reserved' },
        ...(taken && !Number.isNaN(taken.getTime()) ? { takenAt: taken } : {}),
      } satisfies RawPhoto;
    });
}
