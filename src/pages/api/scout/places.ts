import type { APIRoute } from 'astro';
import path from 'node:path';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { readManifest } from '../../../lib/manifest';
import { PHOTOS_DIR } from '../../../lib/paths';
import { dismissPlace, readDismissedPlaces, readGpsLocations, readPlacedLocations, setPlacedLocation } from '../../../lib/photo-locations';
import { LibraryProblem, WINDOW_MIN, describeGap, parseOffset, readPhoneShots, suggestPlaces, type ArchiveShot } from '../../../lib/phone-places';
import { isLatLon } from '../../../lib/scout/mine';

export const prerender = false;

// Issue #139: place suggestions for the archive's dated digital photos, read
// off the iPhone photos in this Mac's Photos library taken at the same time.
// GET lists them; POST { id, action: 'accept', location } places one,
// { id, action: 'dismiss' } turns it down for good. Mac-only, like the rest of
// Scout's "Your photos": the answers are where someone has been.

// The camera's UTC offset is read from the original, since photos ingested
// before #139 never stored it. Cached: an original never changes.
const offsets = new Map<string, number | null>();
async function cameraOffset(filename: string, stored?: string): Promise<number | undefined> {
  if (stored) return parseOffset(stored);
  if (!offsets.has(filename)) {
    try {
      const meta = await sharp(path.join(PHOTOS_DIR, filename), { failOn: 'none' }).metadata();
      offsets.set(filename, (meta.exif && parseOffset(exifReader(meta.exif).Photo?.OffsetTimeOriginal)) ?? null);
    } catch {
      offsets.set(filename, null);
    }
  }
  return offsets.get(filename) ?? undefined;
}

export const GET: APIRoute = async () => {
  try {
    const [manifest, placed, gps, dismissed] = await Promise.all([readManifest(), readPlacedLocations(), readGpsLocations(), readDismissedPlaces()]);
    // Film frames carry the scanner's date, not the day they were taken.
    const candidates = manifest.chapters.flatMap((c) => c.photos.map((p) => ({ p, chapter: c.name })))
      .filter(({ p }) => p.medium === 'digital' && p.exif.capturedAt && !placed[p.id] && !gps[p.id] && !p.exif.location && !dismissed.has(p.id));
    if (candidates.length === 0) return json({ ok: true, suggestions: [] });

    const shots: ArchiveShot[] = [];
    for (const { p } of candidates) {
      shots.push({ id: p.id, capturedAt: p.exif.capturedAt!, offsetMin: await cameraOffset(p.filename, p.exif.offset) });
    }
    const times = shots.map((s) => Date.parse(s.capturedAt));
    const pad = 36 * 3600_000; // either side of the wall-clock range, for any time zone
    const phone = await readPhoneShots(Math.min(...times) - pad, Math.max(...times) + pad);
    const byId = new Map(candidates.map((c) => [c.p.id, c]));
    const suggestions = suggestPlaces(shots, phone, WINDOW_MIN).map((s) => {
      const { p, chapter } = byId.get(s.id)!;
      const smallest = [...p.derivatives].sort((a, b) => a.width - b.width)[0];
      return { ...s, gap: describeGap(s.gapMin), thumb: smallest?.avif, placeholder: p.placeholder, chapter, capturedAt: p.exif.capturedAt };
    });
    return json({ ok: true, suggestions, looked: shots.length });
  } catch (err) {
    if (err instanceof LibraryProblem) return json({ ok: true, suggestions: [], problem: err.message });
    console.error('[scout/places] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { id?: unknown; action?: unknown; location?: unknown };
    if (typeof body.id !== 'string' || !body.id) return json({ ok: false, error: 'Missing id.' }, 400);
    if (body.action === 'dismiss') {
      await dismissPlace(body.id);
      return json({ ok: true });
    }
    if (body.action === 'accept' && isLatLon(body.location)) {
      await setPlacedLocation(body.id, body.location, 'phone');
      return json({ ok: true });
    }
    return json({ ok: false, error: 'action must be accept (with a location) or dismiss.' }, 400);
  } catch (err) {
    console.error('[scout/places] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
