import type { APIRoute } from 'astro';
import { cleanContext, cleanNote, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_NOTE } from '../../lib/feedback';
import { saveFeedback } from '../../lib/feedback-store';
import { FEEDBACK_DIR } from '../../lib/paths';

export const prerender = false;

// Feedback from a page this Mac serves (components/Feedback.astro): a form
// with `note`, the page's `page`, `device`, `viewport` and `build`, and up to
// four `image` files. Kept in the archive's feedback folder; 201 { id }.
// Writes only from this server's own origin (src/middleware.ts).
// Four of the largest pictures, the note, and room for the form's own lines.
const MAX_BODY = MAX_IMAGES * MAX_IMAGE_BYTES + MAX_NOTE * 4 + 64 * 1024;

export const POST: APIRoute = async ({ request }) => {
  // Refused before the form is read into memory, when the length says it's too big.
  if (Number(request.headers.get('content-length')) > MAX_BODY) return json({ ok: false, error: 'Too large' }, 413);
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, error: 'Expected a form' }, 400);
  const files = form.getAll('image').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_IMAGES) return json({ ok: false, error: `At most ${MAX_IMAGES} pictures` }, 400);
  try {
    const images = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const fields = Object.fromEntries(['page', 'device', 'viewport', 'build'].map((k) => [k, form.get(k)]));
    const result = await saveFeedback(FEEDBACK_DIR, { note: cleanNote(form.get('note')), context: cleanContext(fields), images });
    if (!result.ok) return json({ ok: false, error: result.error }, 400);
    return json({ ok: true, id: result.entry.id }, 201);
  } catch (err) {
    console.error('[feedback] save failed', err);
    return json({ ok: false, error: 'Couldn’t save' }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
