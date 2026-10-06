import type { APIRoute } from 'astro';
import os from 'node:os';
import { saveOriginal, processPhoto } from '../../lib/ingest';
import { addPhotos, readStore, readOverrides } from '../../lib/manifest';
import { defaultChapterName, oklchCss } from '../../lib/color';
import { mapPool } from '../../lib/pool';
import type { Photo } from '../../lib/types';
import { looksFor, photoLookRequest, type LookRequest } from '../../lib/match/looks';
import { MIN_CHAPTER_PHOTOS, chapterDna, scoreAgainstChapter } from '../../lib/match/chapter-dna';
import type { LookSignature } from '../../lib/match/resemble';
import { borderlineOf, type Borderline } from '../../lib/borderline';

export const prerender = false;

// Camera RAW is not decodable by this sharp/libvips build — reject it clearly
// rather than failing with a cryptic error mid-batch.
const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|x3f)$/i;
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 2));

// Local ingest: receive originals, save them untouched, run the pipeline in
// parallel, append to the manifest in one write. Runs entirely on this machine.
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return json({ ok: false, error: 'No files received.' }, 400);
    }

    const existing = new Set((await readStore()).map((p) => p.id));
    const overrides = await readOverrides();
    const chapterLabel = (key: string) => overrides.chapters?.[key] ?? defaultChapterName(key);

    type Result = {
      filename: string; id: string; chapterKey: string; chapterName: string;
      swatch: string; medium: 'film' | 'digital' | ''; status: 'added' | 'skipped' | 'unsupported' | 'error';
      error?: string;
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

    const processed = await mapPool(files, CONCURRENCY, async (file): Promise<{ result: Result; photo?: Photo }> => {
      if (RAW_EXT.test(file.name)) {
        return { result: { filename: file.name, id: '', chapterKey: '', chapterName: '', swatch: '', medium: '', status: 'unsupported', error: 'Camera RAW not supported — export to JPEG/TIFF/HEIC first.' } };
      }
      try {
        const buf = Buffer.from(await file.arrayBuffer());
        const { id, filename, existed } = await saveOriginal(buf, file.name);
        if (existed && existing.has(id)) {
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
      attachPlacement(processed, manifest.chapters);
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
