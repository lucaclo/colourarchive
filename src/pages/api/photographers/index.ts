import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PHOTOGRAPHER_CACHE_DIR } from '../../../lib/paths';
import { resolveProfile, type ProfileLink, KIND_LABEL } from '../../../lib/photographers/sources';
import { cachedWork, findOrCreate, readPhotographers, sameLink, updatePhotographers } from '../../../lib/photographers/store';
import { creditFromTyped } from '../../../lib/photographers/credit';
import { forgetSuggestion } from '../../../lib/photographers/suggest';

export const prerender = false;

// The photographers behind the board: list them, and every small change to
// them — favourite, link, credit, seen, pass. One endpoint with an `action`,
// like the board's own add/remove, because each is a one-line change to the
// same private file (lib/photographers/store.ts).

export const GET: APIRoute = async () => json({ ok: true, ...(await readPhotographers()) });

const isLink = (v: unknown): v is ProfileLink =>
  Boolean(v) && typeof v === 'object' && typeof (v as ProfileLink).url === 'string' && (v as ProfileLink).kind in KIND_LABEL;

async function dropWorkCache(id: string) {
  await fs.rm(path.join(PHOTOGRAPHER_CACHE_DIR, 'work', `${id.replace(/[^a-z0-9-]/gi, '_')}.json`), { force: true });
}

export const POST: APIRoute = async ({ request }) => {
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Expected JSON.' }, 400); }
  const id = typeof body.id === 'string' ? body.id : '';
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '');

  try {
    switch (body.action) {
      case 'add': {
        // A profile link (resolved to a name and something readable), or
        // just a name — `find` can link it later.
        // A suggestion arrives with its link already resolved.
        const raw = str('link') || str('name');
        if (!raw && !isLink(body.link)) return json({ ok: false, error: 'Paste a profile link or type a name.' }, 400);
        const credit = isLink(body.link)
          ? { name: str('name') || body.link.url, link: body.link }
          : /^https?:\/\//i.test(raw) ? await resolveProfile(raw) : await creditFromTyped(raw);
        const p = await updatePhotographers((f) => {
          const found = findOrCreate(f, credit!.name, credit!.link);
          if (body.favourite !== false) found.favourite = true;
          return found;
        });
        return json({ ok: true, photographer: p });
      }
      case 'addMany': {
        // Instagram usernames chosen from an export (api/photographers/instagram).
        const names = Array.isArray(body.instagram) ? body.instagram.filter((n): n is string => typeof n === 'string' && /^[a-z0-9._]{1,30}$/i.test(n)) : [];
        if (!names.length) return json({ ok: false, error: 'Pick someone.' }, 400);
        const added = await updatePhotographers((f) => names.map((n) => {
          const p = findOrCreate(f, n, { kind: 'instagram', id: n.toLowerCase(), url: `https://www.instagram.com/${n}/` });
          p.favourite = true;
          return p.id;
        }));
        return json({ ok: true, added: added.length });
      }
      case 'favourite':
        return json({ ok: true, photographer: await updatePhotographers((f) => {
          const p = f.photographers.find((x) => x.id === id);
          if (!p) throw new Error('No such photographer.');
          p.favourite = Boolean(body.on);
          return p;
        }) });
      case 'rename': {
        const name = str('name');
        if (!name) return json({ ok: false, error: 'A name, please.' }, 400);
        return json({ ok: true, photographer: await updatePhotographers((f) => {
          const p = f.photographers.find((x) => x.id === id);
          if (!p) throw new Error('No such photographer.');
          p.name = name.slice(0, 80);
          return p;
        }) });
      }
      case 'link': {
        const link = isLink(body.link) ? body.link : (await resolveProfile(str('link'))).link;
        const p = await updatePhotographers((f) => {
          const p = f.photographers.find((x) => x.id === id);
          if (!p) throw new Error('No such photographer.');
          if (!p.links.some((l) => sameLink(l, link))) p.links.push(link);
          return p;
        });
        await dropWorkCache(id);
        return json({ ok: true, photographer: p });
      }
      case 'unlink': {
        const url = str('url');
        const p = await updatePhotographers((f) => {
          const p = f.photographers.find((x) => x.id === id);
          if (!p) throw new Error('No such photographer.');
          p.links = p.links.filter((l) => l.url !== url);
          return p;
        });
        await dropWorkCache(id);
        return json({ ok: true, photographer: p });
      }
      case 'credit': {
        // Several references at once: "these are all by …".
        const refIds = Array.isArray(body.refIds) ? body.refIds.filter((r): r is string => typeof r === 'string') : [];
        if (!refIds.length) return json({ ok: false, error: 'Pick a reference.' }, 400);
        const typed = str('name') || str('link');
        const credit = id ? null : await creditFromTyped(typed);
        if (!id && !credit) return json({ ok: false, error: 'Who took it?' }, 400);
        const p = await updatePhotographers((f) => {
          const p = id ? f.photographers.find((x) => x.id === id) : findOrCreate(f, credit!.name, credit!.link);
          if (!p) throw new Error('No such photographer.');
          for (const r of refIds) f.credits[r] = p.id;
          return p;
        });
        return json({ ok: true, photographer: p });
      }
      case 'uncredit':
        await updatePhotographers((f) => { delete f.credits[str('refId')]; });
        return json({ ok: true });
      case 'remove':
        await updatePhotographers((f) => {
          f.photographers = f.photographers.filter((p) => p.id !== id);
          for (const [r, p] of Object.entries(f.credits)) if (p === id) delete f.credits[r];
          delete f.marks[id];
          delete f.known[id];
        });
        await dropWorkCache(id);
        return json({ ok: true });
      case 'seen': {
        // Everything on screen now is no longer new.
        const keys = (await cachedWork(id)).map((w) => w.key);
        await updatePhotographers((f) => {
          const p = f.photographers.find((x) => x.id === id);
          if (!p) return;
          p.seenAt = new Date().toISOString();
          f.known[id] = [...new Set([...keys, ...(f.known[id] ?? [])])].slice(0, 600);
        });
        return json({ ok: true });
      }
      case 'mark': {
        const key = str('key');
        await updatePhotographers((f) => {
          const marks = (f.marks[id] ??= {});
          if (body.mark === 'passed') marks[key] = 'passed';
          else if (marks[key] === 'passed') delete marks[key];
        });
        return json({ ok: true });
      }
      case 'dismiss': {
        const key = str('key');
        await updatePhotographers((f) => { if (!f.dismissed.includes(key)) f.dismissed.push(key); });
        await forgetSuggestion(key);
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 400);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
