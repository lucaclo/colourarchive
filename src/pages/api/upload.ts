import type { APIRoute } from 'astro';
import os from 'node:os';
import { saveOriginal, processPhoto } from '../../lib/ingest';
import { addPhotos, readStore, readOverrides } from '../../lib/manifest';
import { defaultChapterName, oklchCss } from '../../lib/color';
import { mapPool } from '../../lib/pool';
import type { Photo } from '../../lib/types';

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
    if (photos.length > 0) await addPhotos(photos);

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
