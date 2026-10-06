/**
 * Your own photographs, as places.
 *
 * Scout's hotspots are other people's evidence that somewhere is worth a
 * camera. This is the archive's own: where *you* stood. Two sources, in a
 * fixed order of trust:
 *
 * 1. **Placed** — a coordinate you dropped on the map by hand. Wins over
 *    everything, because you were there and the file was not asked.
 * 2. **GPS** — the EXIF position the ingest already reads. None of the
 *    archive's photographs carry one today (the a7C II only geotags through
 *    the phone app, and a film scan never can), but a future shot that does
 *    is pinned with no work.
 *
 * Placements live in their own git-ignored file (`photos.locations.json`),
 * never in the overrides or the manifest: the repository is public, and where
 * someone shoots — including, sooner or later, where they live — is not
 * something a push should publish by accident.
 *
 * Pure: no filesystem, no DOM. The server reads the file and the page draws
 * the pins; both go through here so they agree on what counts as a location.
 */

import type { LatLon } from './geo';

/** Hand placements by photo id. */
export type PlacedLocations = Record<string, LatLon>;

export type MineSource = 'placed' | 'gps';

/** One archive photograph, as Scout needs it. */
export interface MinePhoto {
  id: string;
  /** The smallest AVIF derivative — a pin is 44 px across. */
  thumb: string;
  /** Tiny blurred data URI, shown until `thumb` arrives. */
  placeholder: string;
  /** Dominant colour as CSS, for the pin's ring. */
  colour: string;
  chapter: string;
  capturedAt?: string;
  /** Present only when located. */
  lat?: number;
  lon?: number;
  source?: MineSource;
}

/** A finite coordinate on the planet. Everything else is refused. */
export function isLatLon(value: unknown): value is LatLon {
  if (!value || typeof value !== 'object') return false;
  const { lat, lon } = value as Record<string, unknown>;
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

/** Validated rather than trusted — a hand-editable file, same posture
 *  `notes.ts` takes with its own. A bad entry is dropped, not fatal. */
export function parsePlacedLocations(value: unknown): PlacedLocations {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const placed: PlacedLocations = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isLatLon(entry)) placed[id] = { lat: entry.lat, lon: entry.lon };
  }
  return placed;
}

/** What `resolveMinePhotos` needs of a manifest photo — kept structural so
 *  this module never imports the server-side types. */
export interface MineInput {
  id: string;
  placeholder: string;
  derivatives: { width: number; avif: string }[];
  exif: { capturedAt?: string; location?: { lat: number; lon: number } };
}

export interface MineChapterInput {
  name: string;
  colour: string;
  photos: MineInput[];
}

/** Every archive photo, located where it can be, in manifest order. */
export function resolveMinePhotos(chapters: MineChapterInput[], placed: PlacedLocations): MinePhoto[] {
  const out: MinePhoto[] = [];
  for (const chapter of chapters) {
    for (const photo of chapter.photos) {
      const smallest = [...photo.derivatives].sort((a, b) => a.width - b.width)[0];
      if (!smallest) continue;
      const mine: MinePhoto = {
        id: photo.id,
        thumb: smallest.avif,
        placeholder: photo.placeholder,
        colour: chapter.colour,
        chapter: chapter.name,
      };
      if (photo.exif.capturedAt) mine.capturedAt = photo.exif.capturedAt;
      const hand = placed[photo.id];
      const gps = isLatLon(photo.exif.location) ? photo.exif.location : undefined;
      const at = hand ?? gps;
      if (at) {
        mine.lat = at.lat;
        mine.lon = at.lon;
        mine.source = hand ? 'placed' : 'gps';
      }
      out.push(mine);
    }
  }
  return out;
}

/** The located photos as GeoJSON for a clustered source. `order` is the
 *  photo's index in `photos`, so a cluster can carry its first member as a
 *  number (`clusterProperties` aggregates numbers, not strings). */
export function mineFeatures(photos: MinePhoto[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  photos.forEach((photo, order) => {
    if (photo.lat === undefined || photo.lon === undefined) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [photo.lon, photo.lat] },
      properties: { id: photo.id, order },
    });
  });
  return { type: 'FeatureCollection', features };
}
