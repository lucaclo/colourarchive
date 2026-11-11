import type { APIRoute } from 'astro';
import {
  arenaSearch, bskySearch, domainIsName, fetchWork, findSite, getText, profileLinksIn, resolveProfile,
  type Candidate,
} from '../../../lib/photographers/sources';
import { readPhotographers, sameLink } from '../../../lib/photographers/store';

export const prerender = false;

// "Their work elsewhere": for a photographer known only by a name or an
// Instagram handle, the places their work can be read from.
//
// - Their own site, found by the domains photographers use for their name and
//   kept only if the page names them.
// - The profiles that site links to (Flickr, Bluesky, Mastodon, Are.na), and
//   Instagram to open.
// - Bluesky accounts and Are.na channels carrying the whole name.
//
// Each comes with three pictures so you can tell at a glance whether it is
// them, and nothing is linked until you say so (the provenance rule in
// scout/sources/notable.ts: an identity is confirmed, never guessed).

// `sure`: their own site at their own name, with the name on the page —
// enough to link without asking.
type Option = Candidate & { thumbs: string[]; sure?: boolean };

export const GET: APIRoute = async ({ url }) => {
  const file = await readPhotographers();
  const p = file.photographers.find((x) => x.id === url.searchParams.get('id'));
  if (!p) return json({ ok: false, error: 'No such photographer.' }, 404);
  const handle = p.links.find((l) => l.kind === 'instagram')?.id;
  const queries = [...new Set([p.name, handle].filter((q): q is string => Boolean(q)))];

  const found: (Candidate & { sure?: boolean })[] = [];
  const add = (c: Candidate & { sure?: boolean }) => {
    if (p.links.some((l) => sameLink(l, c.link))) return;
    if (found.some((f) => sameLink(f.link, c.link) || f.link.url === c.link.url)) return;
    found.push(c);
  };

  // Their site: a link already kept, else one found from the name.
  const kept = p.links.find((l) => l.kind === 'page' || l.kind === 'feed');
  const site = kept
    ? await getText(kept.url).then((r) => ({ url: r.url, html: r.text })).catch(() => null)
    : await findSite(p.name).catch(() => null);

  await Promise.all([
    (async () => {
      if (!site) return;
      if (!kept) {
        try {
          const r = await resolveProfile(site.url);
          add({ name: r.name, note: `their site · ${new URL(site.url).hostname.replace(/^www\./, '')}`, link: r.link, sure: domainIsName(site.url, p.name) });
        } catch { /* the profiles it links to may still read */ }
      }
      await Promise.all(profileLinksIn(site.html, site.url).slice(0, 8).map(async (href) => {
        try {
          const r = await resolveProfile(href);
          add({ name: r.name, note: `linked from their site`, link: r.link });
        } catch { /* skip that one */ }
      }));
    })(),
    ...queries.flatMap((q) => [bskySearch(q, 3).then((cs) => cs.forEach(add)).catch(() => {}), arenaSearch(q, 3).then((cs) => cs.forEach(add)).catch(() => {})]),
  ]);

  const options: Option[] = await Promise.all(found.slice(0, 8).map(async (c) => {
    if (c.link.kind === 'instagram') return { ...c, thumbs: [] };
    try { return { ...c, thumbs: (await fetchWork(c.link, 6)).slice(0, 3).map((w) => w.thumb) }; } catch { return { ...c, thumbs: [] }; }
  }));
  // Instagram can't show pictures here but is still worth keeping, to open.
  const shown = options.filter((o) => o.thumbs.length || o.link.kind === 'instagram')
    .sort((a, b) => Number(b.thumbs.length > 0) - Number(a.thumbs.length > 0));
  return json({ ok: true, options: shown });
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
