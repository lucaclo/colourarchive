import type { APIRoute } from 'astro';
import { MAX_SECONDS, SAMPLE_RATE, transcribe } from '../../../lib/transcribe';

export const prerender = false;

// A voice note, written down (issue #149). The body is the recording as raw
// 32-bit float samples, mono, 16 kHz — the page resamples before sending, so
// nothing here decodes audio. Returns the words; the page puts them in the
// note for a look before saving.
export const POST: APIRoute = async ({ request }) => {
  try {
    const buf = await request.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength % 4) return json({ ok: false, error: 'No recording received.' }, 400);
    if (buf.byteLength > MAX_SECONDS * SAMPLE_RATE * 4) return json({ ok: false, error: `Keep a voice note under ${MAX_SECONDS} seconds.` }, 413);
    return json({ ok: true, text: await transcribe(new Float32Array(buf)) });
  } catch (err) {
    console.error('[notes/voice] failed', err);
    return json({ ok: false, error: 'It couldn’t be written down.' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
