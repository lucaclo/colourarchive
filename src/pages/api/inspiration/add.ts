import type { APIRoute } from 'astro';
import { addInspiration, fetchImageFromUrl } from '../../../lib/inspiration';
import { defaultChapterName, oklchCss } from '../../../lib/color';
import { autoCredit } from '../../../lib/photographers/credit';

export const prerender = false;

const RAW_EXT = /\.(cr2|cr3|nef|arw|dng|raf|orf|rw2|pef|srw|x3f)$/i;

// Add reference images to the inspiration board — by file upload OR by URL
// (the app is local, so it fetches the remote image and saves a copy). A free
// `source` string records attribution (photographer / link).
export const POST: APIRoute = async ({ request }) => {
  try {
    const ct = request.headers.get('content-type') || '';
    const results: Awaited<ReturnType<typeof ingest>>[] = [];

    if (ct.includes('application/json')) {
      const { url, source } = await request.json();
      if (!url || typeof url !== 'string') return json({ ok: false, error: 'Provide an image URL.' }, 400);
      // A page link (a post, an article) is followed to its og:image.
      let got: { buf: Buffer; name: string; html?: string };
      try { got = await fetchImageFromUrl(url); } catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
      results.push(await ingest(got.buf, got.name, (source || url).trim(), { url, html: got.html, typed: source }));
    } else {
      const form = await request.formData();
      const source = String(form.get('source') || '').trim();
      const files = form.getAll('images').filter((f): f is File => f instanceof File);
      if (files.length === 0) return json({ ok: false, error: 'No images received.' }, 400);
      for (const f of files) {
        if (RAW_EXT.test(f.name)) { results.push({ filename: f.name, status: 'unsupported', error: 'Camera RAW not supported.' }); continue; }
        const buf = Buffer.from(await f.arrayBuffer());
        results.push(await ingest(buf, f.name, source, { typed: source }));
      }
    }

    return json({ ok: true, added: results.filter((r) => r.status === 'added').length, results });
  } catch (err) {
    console.error('[inspiration/add] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

async function ingest(buf: Buffer, name: string, source: string, from: { url?: string; html?: string; typed?: string }) {
  try {
    const { photo, existed } = await addInspiration(buf, name, source);
    if (existed || !photo) return { filename: name, status: 'skipped' };
    const by = await autoCredit(photo.id, { ...from, buf });
    return {
      filename: name, id: photo.id, status: 'added',
      chapterName: defaultChapterName(photo.chapter), swatch: oklchCss(photo.oklch), source: photo.source || '',
      // Who it was credited to, so the row can offer more of their work.
      photographer: by,
    };
  } catch (err) {
    return { filename: name, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
