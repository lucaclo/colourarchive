import type { APIRoute } from 'astro';
import { readInspStore } from '../../../lib/inspiration';
import { readPhotographers } from '../../../lib/photographers/store';
import { printOf, traitsOf } from '../../../lib/photographers/suggest';
import { populationQuartiles, saveMeasures } from '../../../lib/photographers/style';

export const prerender = false;

// A photographer's look in a few words ("lifted blacks · muted colour"),
// measured from their pictures against yours and the board's. Asked for when
// their sheet opens; the first time measures a handful of thumbnails, after
// that it's cached (style.ts).

export const GET: APIRoute = async ({ url }) => {
  const file = await readPhotographers();
  const p = file.photographers.find((x) => x.id === url.searchParams.get('id'));
  if (!p) return json({ ok: false, error: 'No such photographer.' }, 404);
  try {
    const board = await readInspStore();
    const measures = await printOf(p, file.credits, board);
    const words = measures.length >= 2 ? (await traitsOf(measures, await populationQuartiles())).map((t) => t.word) : [];
    await saveMeasures();
    return json({ ok: true, words, measured: measures.length });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
