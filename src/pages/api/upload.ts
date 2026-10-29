import type { APIRoute } from 'astro';
import { ingestBatch } from '../../lib/ingest-batch';

export const prerender = false;

// Local ingest: receive originals and hand them to the shared batch pipeline
// (lib/ingest-batch.ts). Runs entirely on this machine.
export const POST: APIRoute = async ({ request }) => {
  try {
    const form = await request.formData();
    const files = form.getAll('photos').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return json({ ok: false, error: 'No files received.' }, 400);
    }
    const results = await ingestBatch(files.map((f) => ({ name: f.name, read: async () => Buffer.from(await f.arrayBuffer()) })));
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
