import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { PHOTOS_DIR } from './paths';
import { parseOffset } from './phone-places';

// When a photo was taken, in true UTC (issues #139 and #143). The archive
// stores the camera's wall-clock time; the camera's own offset comes from
// EXIF (`exif.offset`, stored since #139) or, for photos ingested before
// that, from the original itself — cached, since an original never changes.
const offsets = new Map<string, number | null>();

export async function cameraOffset(filename: string, stored?: string): Promise<number | undefined> {
  if (stored) return parseOffset(stored);
  if (!offsets.has(filename)) {
    try {
      const meta = await sharp(path.join(PHOTOS_DIR, filename), { failOn: 'none' }).metadata();
      offsets.set(filename, (meta.exif && parseOffset(exifReader(meta.exif).Photo?.OffsetTimeOriginal)) ?? null);
    } catch {
      offsets.set(filename, null);
    }
  }
  return offsets.get(filename) ?? undefined;
}

/** Epoch ms, or null when the photo has no date or no known offset. */
export async function takenAtUtc(photo: { filename: string; exif: { capturedAt?: string; offset?: string } }): Promise<number | null> {
  if (!photo.exif.capturedAt) return null;
  const offset = await cameraOffset(photo.filename, photo.exif.offset);
  if (offset === undefined) return null;
  return Date.parse(photo.exif.capturedAt) - offset * 60_000;
}
