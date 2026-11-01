import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import { readManifest } from '../../lib/manifest';
import { readGpsLocations, readPlacedLocations } from '../../lib/photo-locations';
import { reverseGeocode } from '../../lib/scout/geocode';
import { inferRolls, rollTitle } from '../../lib/rolls';
import { ROLLS_PATH } from '../../lib/paths';

export const prerender = false;

// Film roll titles (issue #146): "Roll 4 · Kyoto · Mar 2025", from the dated
// and placed frames in it, or a name given by hand. GET gives every title by
// roll key; POST { key, name } renames one (an empty name goes back to the
// inferred title). Names live in the private photos.rolls.json: a roll's
// name is often a place.

async function readNames(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(ROLLS_PATH, 'utf8')); } catch { return {}; }
}

async function titles(): Promise<Record<string, string>> {
  const [manifest, names, placed, gps] = await Promise.all([readManifest(), readNames(), readPlacedLocations(), readGpsLocations()]);
  const film = manifest.chapters.flatMap((c) => c.photos).filter((p) => p.medium === 'film');
  const out: Record<string, string> = {};
  for (const roll of inferRolls(film.map((p) => ({ id: p.id, filename: p.filename, camera: p.exif.camera, software: p.exif.software, capturedAt: p.exif.capturedAt })))) {
    let place: string | null = null;
    if (!names[roll.key]) {
      const at = roll.ids.map((id) => placed[id] ?? gps[id]).find(Boolean);
      if (at) {
        const p = await reverseGeocode(at.lat, at.lon, 10);
        place = p.kind === 'point' ? null : p.name;
      }
    }
    out[roll.key] = rollTitle(roll, place, names[roll.key]);
  }
  return out;
}

export const GET: APIRoute = async () => json({ ok: true, titles: await titles() });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { key?: unknown; name?: unknown };
    if (typeof body.key !== 'string' || typeof body.name !== 'string') return json({ ok: false, error: 'key and name are needed.' }, 400);
    const names = await readNames();
    const name = body.name.trim().slice(0, 80);
    // Saving the title it already shows is not a rename.
    const current = (await titles())[body.key];
    if (!name || /^Roll \d+( · |$)/.test(name) && name === current) delete names[body.key];
    else names[body.key] = name;
    await fs.writeFile(ROLLS_PATH, JSON.stringify(names, null, 2));
    return json({ ok: true, titles: await titles() });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
