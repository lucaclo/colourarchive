import type { APIRoute } from 'astro';
import { anyReadable, newItems, readPhotographers, workFor } from '../../../lib/photographers/store';

export const prerender = false;

// One photographer's public work, or (?news=1) how much is new from each
// favourite. Fetched while the board is open and cached for half an hour
// (store.ts), so opening the board twice in a row asks nobody twice.

export const GET: APIRoute = async ({ url }) => {
  const file = await readPhotographers();

  if (url.searchParams.get('news')) {
    const favs = [];
    for (const p of file.photographers) if (p.favourite && await anyReadable(p.links)) favs.push(p);
    const counts: Record<string, number> = {};
    const covers: Record<string, string> = {};
    await Promise.all(favs.map(async (p) => {
      try {
        const { items } = await workFor(p);
        counts[p.id] = newItems(file, p.id, items).length;
        if (items[0]) covers[p.id] = items[0].thumb;
      } catch { /* that one is skipped */ }
    }));
    return json({ ok: true, counts, covers });
  }

  const p = file.photographers.find((x) => x.id === url.searchParams.get('id'));
  if (!p) return json({ ok: false, error: 'No such photographer.' }, 404);
  const { items, errors } = await workFor(p, url.searchParams.get('force') === '1');
  const marks = file.marks[p.id] ?? {};
  const fresh = new Set(newItems(file, p.id, items).map((i) => i.key));
  return json({
    ok: true,
    seenAt: p.seenAt ?? null,
    errors,
    items: items.map((i) => ({ ...i, mark: marks[i.key] ?? null, isNew: fresh.has(i.key) })),
  });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
