import type { APIRoute } from 'astro';
import { unzip } from '../../../lib/unzip';
import { rankInstagram, wantedInExport } from '../../../lib/photographers/instagram';
import { readPhotographers } from '../../../lib/photographers/store';

export const prerender = false;

// Read an Instagram "Download your information" export (the .zip, or the
// JSON files from inside it) and rank who you save and like most. Nothing
// is stored here: the list comes back to choose from, and only the chosen
// become photographers (POST /api/photographers, action "addMany"). The
// export itself is never kept.

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try { form = await request.formData(); } catch { return json({ ok: false, error: 'Expected the export file.' }, 400); }
  const uploads = form.getAll('files').filter((f): f is File => f instanceof File);
  if (!uploads.length) return json({ ok: false, error: 'Choose the export .zip.' }, 400);

  const texts: { name: string; text: string }[] = [];
  try {
    for (const f of uploads) {
      const buf = Buffer.from(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name) || buf.readUInt32LE(0) === 0x04034b50) {
        for (const e of unzip(buf, wantedInExport)) texts.push({ name: e.name, text: e.data.toString('utf8') });
      } else if (/\.json$/i.test(f.name)) {
        texts.push({ name: f.name, text: buf.toString('utf8') });
      }
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
  if (!texts.length) {
    return json({ ok: false, error: 'No following, saved or liked lists in that. Request the export as JSON, not HTML.' }, 400);
  }

  const ranked = rankInstagram(texts).slice(0, 80);
  if (!ranked.length) return json({ ok: false, error: 'Nobody saved or liked in that export.' }, 400);
  const file = await readPhotographers();
  const known = new Set(file.photographers.flatMap((p) => p.links.filter((l) => l.kind === 'instagram').map((l) => (l.id ?? '').toLowerCase())));
  return json({ ok: true, people: ranked.map((p) => ({ ...p, known: known.has(p.username) })) });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
