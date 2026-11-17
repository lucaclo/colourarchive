import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveOriginal, processPhoto, hashBuffer } from './ingest';
import { PHOTOS_DIR } from './paths';
import { addPhotos, readStore, readOverrides } from './manifest';
import { defaultChapterName, oklchCss } from './color';
import { mapPool } from './pool';
import type { Photo } from './types';
import { looksFor, photoLookRequest, type LookRequest } from './match/looks';
import { MIN_CHAPTER_PHOTOS, chapterDna, scoreAgainstChapter } from './match/chapter-dna';
import type { LookSignature } from './match/resemble';
import { borderlineOf, type Borderline } from './borderline';
import { addGpsLocations } from './photo-locations';

// One batch of originals into the archive: save each untouched, run the
// pipeline in parallel, append to the manifest in one write. Shared by the
// upload endpoint and the iCloud inbox (inbox.ts), so a photo exported to the
// inbox lands exactly as one dropped on Add & remove would.

// Camera RAW is not decodable by this sharp/libvips build — reject it clearly
// rather than failing with a cryptic error mid-batch.
export const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|x3f)$/i;
export const RAW_MESSAGE = 'Camera RAW not supported — export to JPEG or TIFF first.';
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 2));

/** Why a file wasn't added, in plain words for the upload rows and the inbox
 *  note. The image library's own message goes to the log instead. */
export function plainReason(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/buffer is empty/i.test(raw)) return 'Empty file';
  if (/unsupported image format|not a known file format/i.test(raw)) return 'Not a picture we can read';
  return "Couldn't add this one";
}

/** Below this on its long side a picture is still added, with a note. */
const SMALL_PX = 200;
export function sizeNote(width: number, height: number): string | undefined {
  return width > 0 && height > 0 && Math.max(width, height) < SMALL_PX ? `Very small (${width} × ${height})` : undefined;
}

export type IngestResult = {
  filename: string; id: string; chapterKey: string; chapterName: string;
  swatch: string; medium: 'film' | 'digital' | ''; status: 'added' | 'skipped' | 'unsupported' | 'error';
  error?: string;
  /** Added, but worth a word: e.g. 'Very small (30 × 30)'. */
  note?: string;
  // Enough for the client to add the photo to its manage grid immediately —
  // it used to need a full page reload before a new photo could be
  // relabelled or removed.
  thumb?: string; placeholder?: string; genre?: string;
  // Issue #61: how this photo's own measured look sits against the
  // chapter it just landed in. `null` means the chapter has too few
  // *other* photos yet to have a settled look worth comparing to —
  // refused rather than guessed at, not an error.
  chapterFit?: { verdict: 'keeps' | 'borderline' | 'new-look'; distance: number; note: string } | null;
  borderline?: Borderline | null;
  neighbours?: string[];
};

/** One file to ingest: its name, and how to read its bytes. Reading is
 *  deferred so a big batch is never all in memory at once. */
export type IngestItem = { name: string; read: () => Promise<Buffer> };

/**
 * Photos (by content hash) some batch is adding right now. The page sends
 * three uploads at once, and the inbox runs beside them: two copies of one
 * picture arriving together each found it new, both were saved, and the store
 * kept one while both rows said "added" and an original stayed behind with no
 * entry. Claimed synchronously after hashing, released once the batch's store
 * write is done, so the second copy comes back as a duplicate instead.
 */
const inFlight = new Set<string>();

/** Ingest `items`, one result per item in the same order. One bad file never
 *  sinks the batch: it comes back as `error` and the rest carry on. */
export async function ingestBatch(items: IngestItem[]): Promise<IngestResult[]> {
  const claimed = new Set<string>();
  try {
    return await ingestClaiming(items, claimed);
  } finally {
    for (const id of claimed) inFlight.delete(id);
  }
}

async function ingestClaiming(items: IngestItem[], claimed: Set<string>): Promise<IngestResult[]> {
  const existing = new Set((await readStore()).map((p) => p.id));
  const inStore = async (id: string) => existing.has(id) || (await readStore()).some((p) => p.id === id);
  const overrides = await readOverrides();
  const chapterLabel = (key: string) => overrides.chapters?.[key] ?? defaultChapterName(key);

  const processed = await mapPool(items, CONCURRENCY, async (file): Promise<{ result: IngestResult; photo?: Photo; savedNew?: string }> => {
    if (RAW_EXT.test(file.name)) {
      return { result: { filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'unsupported', error: RAW_MESSAGE } };
    }
    // What saveOriginal wrote, so a failure after it can take its own file
    // back out — never one that was already on disk.
    let saved: { filename: string; existed: boolean } | undefined;
    try {
      const buf = await file.read();
      // By content, before anything is written: the same photo exported again
      // under another name is still the same photo, and used to be saved as a
      // second original and reported as added. Also when another copy is being
      // added at this moment (see `inFlight`); claimed before any await.
      const hash = hashBuffer(buf);
      const duplicate = { result: { filename: file.name, id: hash, chapterKey: '', chapterName: '', swatch: '', medium: '' as const, status: 'skipped' as const } };
      if (inFlight.has(hash)) return duplicate;
      inFlight.add(hash);
      claimed.add(hash);
      if (await inStore(hash)) return duplicate;
      const { id, filename, existed } = await saveOriginal(buf, file.name);
      saved = { filename, existed };
      if (existed && existing.has(id)) {
        return { result: { filename, id, chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'skipped' } };
      }
      const photo = await processPhoto(buf, id, filename);
      const note = sizeNote(photo.width, photo.height);
      return {
        photo,
        ...(existed ? {} : { savedNew: filename }),
        result: {
          filename, id,
          chapterKey: photo.chapter,
          chapterName: chapterLabel(photo.chapter),
          swatch: oklchCss(photo.oklch),
          medium: photo.medium,
          status: 'added',
          thumb: photo.derivatives[0]?.avif,
          placeholder: photo.placeholder,
          genre: photo.genre ?? '',
          ...(note ? { note } : {}),
        },
      };
    } catch (err) {
      console.warn(`[ingest] ${file.name} not added:`, err instanceof Error ? err.message : err);
      if (saved && !saved.existed) {
        await fs.rm(path.join(PHOTOS_DIR, saved.filename), { force: true }).catch((e) => console.warn('[ingest] original left behind', saved?.filename, e?.message));
      }
      return { result: { filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'error', error: plainReason(err) } };
    }
  });

  // One store write / rebuild for the whole batch (parallel-safe).
  const photos = processed.map((p) => p.photo).filter((p): p is Photo => Boolean(p));
  // Issue #139: a photo's GPS goes to the private photos.gps.json, never into
  // photos.json or the manifest, which are committed to a public repository.
  const gps: Record<string, { lat: number; lon: number }> = {};
  for (const p of photos) {
    if (p.exif.location) gps[p.id] = p.exif.location;
    delete p.exif.location;
  }
  if (photos.length > 0) {
    let manifest;
    try {
      await addGpsLocations(gps);
      manifest = await addPhotos(photos);
    } catch (err) {
      // Nothing of this batch reached the store: take back the originals it
      // wrote, so no file is left that no entry owns.
      await Promise.all(processed.map((p) => p.savedNew && fs.rm(path.join(PHOTOS_DIR, p.savedNew), { force: true }).catch(() => {})));
      throw err;
    }
    attachPlacement(processed, manifest.chapters);
    await attachChapterFits(processed, photos, manifest.chapters);
  }
  return processed.map((p) => p.result);
}

/** How many of a chapter's photos to show beside a new arrival. */
const NEIGHBOURS = 4;

/**
 * Where each just-added photo actually landed — issue #105.
 *
 * `processPhoto` only knows the base chapter; the band split and the fold of
 * tiny chapters run in the rebuild, so the chapter a reader will find the
 * photo in is read back from the manifest rather than assumed. Alongside it:
 * the photos it now sits among (closest in colour first, so the strip answers
 * "does it belong with these?"), and whether it sits on a chapter edge.
 */
function attachPlacement(
  processed: Array<{ result: { status: string; id: string; chapterKey: string; chapterName: string; borderline?: Borderline | null; neighbours?: string[] }; photo?: Photo }>,
  chapters: { key: string; name: string; photos: Photo[] }[],
): void {
  const where = new Map<string, { key: string; name: string; photos: Photo[] }>();
  for (const ch of chapters) for (const p of ch.photos) where.set(p.id, ch);
  const lab = (p: Photo) => {
    const r = (p.oklch.H * Math.PI) / 180;
    return [p.oklch.L, p.oklch.C * Math.cos(r), p.oklch.C * Math.sin(r)];
  };
  for (const entry of processed) {
    if (entry.result.status !== 'added' || !entry.photo) continue;
    const ch = where.get(entry.photo.id);
    if (!ch) continue;
    const me = lab(entry.photo);
    entry.result.chapterKey = ch.key;
    entry.result.chapterName = ch.name;
    entry.result.borderline = borderlineOf(entry.photo.oklch);
    entry.result.neighbours = ch.photos
      .filter((p) => p.id !== entry.photo!.id)
      .map((p) => ({ p, d: Math.hypot(...lab(p).map((v, i) => v - me[i])) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, NEIGHBOURS)
      .map(({ p }) => p.derivatives[0]?.avif)
      .filter((src): src is string => Boolean(src));
  }
}

/**
 * Score every just-added photo against the chapter it landed in — issue #61.
 *
 * One DNA per chapter actually touched by this batch, not per photo: two
 * photos landing in the same chapter (the common case for a batch from one
 * shoot) share it rather than paying for the same measurement twice. The DNA
 * excludes every photo in *this* batch, including ones bound for the same
 * chapter — a chapter's "settled look" is what was already there, not what a
 * handful of new arrivals happen to agree with each other about.
 */
async function attachChapterFits(
  processed: Array<{ result: { status: string; chapterKey: string; chapterFit?: unknown }; photo?: Photo }>,
  newPhotos: Photo[],
  chapters: { key: string; photos: Photo[] }[],
): Promise<void> {
  const newIds = new Set(newPhotos.map((p) => p.id));
  const chapterByKey = new Map(chapters.map((ch) => [ch.key, ch]));
  const dnaCache = new Map<string, LookSignature | null>();

  async function dnaFor(chapterKey: string): Promise<LookSignature | null> {
    if (dnaCache.has(chapterKey)) return dnaCache.get(chapterKey) ?? null;
    const others = (chapterByKey.get(chapterKey)?.photos ?? []).filter((p) => !newIds.has(p.id));
    const dna =
      others.length < MIN_CHAPTER_PHOTOS
        ? null
        : chapterDna((await looksFor(others.map(photoLookRequest).filter((r): r is LookRequest => r != null))).signatures);
    dnaCache.set(chapterKey, dna);
    return dna;
  }

  const { signatures } = await looksFor(newPhotos.map(photoLookRequest).filter((r): r is LookRequest => r != null));
  const signatureById = new Map(signatures.map((s) => [s.id, s]));

  for (const entry of processed) {
    if (entry.result.status !== 'added' || !entry.photo) continue;
    const signature = signatureById.get(entry.photo.id);
    // The chapter it landed in, which attachPlacement read back from the
    // manifest — not `photo.chapter`, the base key, which misses the band
    // split and scored a Deep Orange arrival against plain Orange's look.
    const dna = await dnaFor(entry.result.chapterKey || entry.photo.chapter);
    entry.result.chapterFit =
      dna && signature
        ? (() => {
            const fit = scoreAgainstChapter(signature, dna);
            return { verdict: fit.verdict, distance: Number(fit.resemblance.distance.toFixed(3)), note: fit.note };
          })()
        : null;
  }
}
