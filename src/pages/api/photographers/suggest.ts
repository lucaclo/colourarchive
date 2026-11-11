import type { APIRoute } from 'astro';
import { lastSuggestions, suggest } from '../../../lib/photographers/suggest';

export const prerender = false;

// Photographers like your favourites. GET is the last list; POST runs a new
// search and streams its progress as one JSON object per line, because
// measuring a few hundred pictures takes long enough that a silent spinner
// would read as stuck.

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ ok: true, ...(await lastSuggestions() ?? { at: null, items: [] }) }), {
    headers: { 'content-type': 'application/json' },
  });
};

export const POST: APIRoute = async () => {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => { try { controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* closed */ } };
      try {
        const items = await suggest((p) => send({ progress: p }));
        send({ ok: true, items });
      } catch (err) {
        send({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } });
};
