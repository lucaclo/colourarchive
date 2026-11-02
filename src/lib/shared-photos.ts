/**
 * Photos shared to Scout's hotspots: which ones, and the feed the published
 * site carries for them.
 *
 * The share list is ids only, in a git-ignored file beside the locations
 * (`SHARED_PATH`). Places stay private for every photo except the shared
 * ones, and even those only leave the Mac inside a build: the feed is written
 * into the site as `/scout-shared.json`, never into the repository.
 */
import fs from 'node:fs/promises';
import { SHARED_PATH } from './paths';
import { readGpsLocations, readPlacedLocations } from './photo-locations';
import { takenAtUtc } from './photo-time';
import { ARCHIVE_CREDIT, type SharedFeed, type SharedPhoto } from './scout/sources/archive';
import type { Manifest, Photo } from './types';

export async function readSharedIds(): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(SHARED_PATH, 'utf8'));
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

let chain: Promise<unknown> = Promise.resolve();

/** Share or stop sharing one photo. Serialised, written atomically. */
export function setShared(id: string, shared: boolean): Promise<void> {
  const run = chain.then(async () => {
    const ids = await readSharedIds();
    if (shared) ids.add(id);
    else ids.delete(id);
    const tmp = `${SHARED_PATH}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify([...ids].sort(), null, 2));
    await fs.rename(tmp, SHARED_PATH);
  });
  chain = run.catch(() => {});
  return run;
}

/** "Street photograph, Green, July 2026": the name the archive itself gives a photo. */
export function sharedTitle(p: Pick<Photo, 'genre' | 'medium' | 'exif'>, chapter: string): string {
  const kind = p.genre ? `${p.genre[0].toUpperCase()}${p.genre.slice(1)} photograph` : 'Photograph';
  const when = p.medium === 'digital' && p.exif.capturedAt
    ? new Date(p.exif.capturedAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';
  return [p.medium === 'film' ? `${kind} on film` : kind, chapter, when].filter(Boolean).join(', ');
}

export interface ShareState {
  shared: string[];
  /** Photos with a place, which are the only ones that can be shared. */
  located: string[];
}

export async function shareState(manifest: Manifest): Promise<ShareState> {
  const [ids, placed, gps] = await Promise.all([readSharedIds(), readPlacedLocations(), readGpsLocations()]);
  const all = manifest.chapters.flatMap((c) => c.photos.map((p) => p.id));
  return { shared: all.filter((id) => ids.has(id)), located: all.filter((id) => placed[id] || gps[id]) };
}

/** The feed: every shared photo that has a place, at its exact place. */
export async function buildSharedFeed(manifest: Manifest): Promise<SharedFeed> {
  const [ids, placed, gps] = await Promise.all([readSharedIds(), readPlacedLocations(), readGpsLocations()]);
  const photos: SharedPhoto[] = [];
  for (const chapter of manifest.chapters) {
    for (const p of chapter.photos) {
      if (!ids.has(p.id)) continue;
      const at = placed[p.id] ?? gps[p.id];
      const small = [...p.derivatives].sort((a, b) => a.width - b.width).find((d) => d.width >= 400) ?? p.derivatives[0];
      if (!at || !small) continue;
      const taken = await takenAtUtc(p).catch(() => null);
      photos.push({
        id: p.id,
        lat: at.lat,
        lon: at.lon,
        thumb: small.avif,
        thumbWidth: small.width,
        thumbHeight: Math.round((small.width * p.height) / p.width),
        title: sharedTitle(p, chapter.name),
        ...(taken ? { takenAt: new Date(taken).toISOString() } : {}),
      });
    }
  }
  return { credit: ARCHIVE_CREDIT, photos };
}
