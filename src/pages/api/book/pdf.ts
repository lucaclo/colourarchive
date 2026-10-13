import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { buildBookPdf } from '../../../lib/book-print';
import { isTrimId } from '../../../lib/book-pages';
import { BOOK_PRINT_DIR } from '../../../lib/paths';

export const prerender = false;

// The book's print PDF (book-print.ts).
//
// POST builds it and streams progress as newline-delimited JSON, one line per
// page, then a final line with the download link: a hundred pages at 300 dpi
// takes long enough that a silent button reads as a broken one.
// GET ?file=<name> serves a PDF already built. The name is checked against
// the one pattern buildBookPdf writes, so this can't be pointed elsewhere.

export const POST: APIRoute = async ({ url }) => {
  const trimParam = url.searchParams.get('trim');
  const trim = isTrimId(trimParam) ? trimParam : undefined;
  const bleed = url.searchParams.get('bleed') === '1';
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch { /* client went away */ }
      };
      try {
        const { name, check } = await buildBookPdf({ trim, bleed }, (p) => send({ type: 'progress', ...p }));
        send({ type: 'done', ok: true, href: `/api/book/pdf?file=${encodeURIComponent(name)}`, check });
      } catch (err) {
        console.error('[book/pdf] failed', err);
        send({ type: 'done', ok: false, error: err instanceof Error ? err.message : String(err) });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
};

const NAME = /^colour-archive-[a-z0-9-]+\.pdf$/;

export const GET: APIRoute = async ({ url }) => {
  const name = url.searchParams.get('file') || '';
  if (!NAME.test(name)) return new Response('Not found', { status: 404 });
  const file = path.join(BOOK_PRINT_DIR, name);
  let size: number;
  try { size = (await fs.promises.stat(file)).size; } catch { return new Response('Not found', { status: 404 }); }
  const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(size),
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'no-store',
    },
  });
};
