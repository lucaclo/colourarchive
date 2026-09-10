import type { APIRoute } from 'astro';
import os from 'node:os';
import { saveOriginal, processPhoto } from '../../lib/ingest';
import { addPhotos, readOverrides } from '../../lib/manifest';
import { defaultChapterName, oklchCss } from '../../lib/color';
import { mapPool } from '../../lib/pool';
import type { Photo } from '../../lib/types';
import { looksFor, photoLookRequest, type LookRequest } from '../../lib/match/looks';
import { MIN_CHAPTER_PHOTOS, chapterDna, scoreAgainstChapter } from '../../lib/match/chapter-dna';
import type { LookSignature } from '../../lib/match/resemble';

export const prerender = false;

// Camera RAW is not decodable by this sharp/libvips build — reject it clearly
// rather than failing with a cryptic error mid-batch.
const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|x3f)$/i;
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 2));
// Generous for a single frame (the archive's own RAWs run ~50MB before export
// shrinks them) — this exists to turn an accidental video or a mis-renamed
// huge TIFF into a clean rejected row instead of fully buffering it (up to
// CONCURRENCY times over) before anything downstream has a chance to notice.
const MAX_FILE_BYTES = 150 * 1024 * 1024;

// Local ingest: receive originals, save them untouched, run the pipeline in
// parallel, append to the manifest in one write. Runs entirely on this machine.
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return json({ ok: false, error: 'No files received.' }, 400);
    }

    const overrides = await readOverrides();
    const chapterLabel = (key: string) => overrides.chapters?.[key] ?? defaultChapterName(key);

    type Result = {
      filename: string; id: string; chapterKey: string; chapterName: string;
      swatch: string; medium: 'film' | 'digital' | ''; status: 'added' | 'skipped' | 'unsupported' | 'error';
      error?: string;
      // Enough for the client to add the photo to its manage grid immediately —
      // it used to need a full page reload before a new photo could be
      // relabelled or removed.
      thumb?: string; placeholder?: string; genre?: string; mediumUncertain?: boolean;
      // Issue #61: how this photo's own measured look sits against the
      // chapter it just landed in. `null` means the chapter has too few
      // *other* photos yet to have a settled look worth comparing to —
      // refused rather than guessed at, not an error.
      chapterFit?: { verdict: 'keeps' | 'borderline' | 'new-look'; distance: number; note: string } | null;
    };

    const processed = await mapPool(files, CONCURRENCY, async (file): Promise<{ result: Result; photo?: Photo }> => {
      if (RAW_EXT.test(file.name)) {
        return { result: { filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'unsupported', error: 'Camera RAW not supported — export to JPEG/TIFF/HEIC first.' } };
      }
      if (file.size > MAX_FILE_BYTES) {
        return {
          result: {
            filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '',
            status: 'unsupported',
            error: `Too large (${(file.size / (1024 * 1024)).toFixed(0)}MB, max ${MAX_FILE_BYTES / (1024 * 1024)}MB) — is this really a photo?`,
          },
        };
      }
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const { id, filename, existed } = await saveOriginal(buf, file.name);
        // saveOriginal now serialises concurrent saves of the same content
        // (see its own comment), so `existed` alone is reliable for both a
        // photo already in the archive before this upload AND a duplicate of
        // another file within this same batch — the latter used to slip
        // through and run the full pipeline a second time, because it could
        // only be checked against a snapshot of the store taken before the
        // batch started.
        if (existed) {
          return { result: { filename, id, chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'skipped' } };
        }
        const photo = await processPhoto(buf, id, filename);
        return {
          photo,
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
            mediumUncertain: photo.mediumUncertain,
          },
        };
      } catch (err) {
        return { result: { filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'error', error: err instanceof Error ? err.message : String(err) } };
      }
    });

    // One store write / rebuild for the whole batch (parallel-safe).
    const photos = processed.map((p) => p.photo).filter((p): p is Photo => Boolean(p));
    if (photos.length > 0) {
      const manifest = await addPhotos(photos);
      await attachChapterFits(processed, photos, manifest.chapters);
    }

    const results = processed.map((p) => p.result);
    return json({
      ok: true,
      added: results.filter((r) => r.status === 'added').length,
      results,
    });
  } catch (err) {
    console.error('[upload] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

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
  processed: Array<{ result: { status: string; chapterFit?: unknown }; photo?: Photo }>,
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
    const dna = await dnaFor(entry.photo.chapter);
    entry.result.chapterFit =
      dna && signature
        ? (() => {
            const fit = scoreAgainstChapter(signature, dna);
            return { verdict: fit.verdict, distance: Number(fit.resemblance.distance.toFixed(3)), note: fit.note };
          })()
        : null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
