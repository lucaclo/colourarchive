import type { APIRoute } from 'astro';
import { readStore } from '../../../lib/manifest';
import { readGpsLocations, readPlacedLocations } from '../../../lib/photo-locations';
import { takenAtUtc } from '../../../lib/photo-time';
import { readingsAt, recordReadings } from '../../../lib/sky-readings';
import { NEAR_M, NEAR_MS, skyTally, tallyLines, type CheckPhoto } from '../../../lib/scout/sky-check';
import { metresBetween } from '../../../lib/scout/spots';
import { skyColourOf } from '../../../lib/sky-measure';

export const prerender = false;

// Issue #143. POST { lat, lon, readings } keeps what Scout said about a kept
// spot's coming sunrises and sunsets. GET ?lat&lon checks the past ones
// against the archive's photos from there: the tally in words, and each
// evening's reading beside the photos it was checked against.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = (await request.json()) as { lat?: unknown; lon?: unknown; readings?: unknown };
    const lat = Number(body.lat), lon = Number(body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Array.isArray(body.readings)) return json({ ok: false, error: 'lat, lon and readings are needed.' }, 400);
    return json({ ok: true, kept: await recordReadings({ lat, lon }, body.readings) });
  } catch (err) {
    console.error('[scout/sky-check] save failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

export const GET: APIRoute = async ({ url }) => {
  try {
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false, error: 'lat and lon are needed.' }, 400);
    const readings = await readingsAt({ lat, lon });
    if (!readings.length) return json({ ok: true, readings: 0, lines: [], evenings: [] });
    const [store, placed, gps] = await Promise.all([readStore(), readPlacedLocations(), readGpsLocations()]);
    const photos: CheckPhoto[] = [];
    for (const p of store) {
      const where = placed[p.id] ?? gps[p.id];
      if (!where || metresBetween(where, { lat, lon }) > NEAR_M) continue;
      const takenAt = await takenAtUtc(p);
      if (takenAt == null || !readings.some((r) => Math.abs(r.when - takenAt) <= NEAR_MS)) continue;
      // Only now, for a photo that matches an evening, is the sky segmented.
      const sky = await skyColourOf(p).catch((err) => { console.warn('[sky-check] segmentation skipped', err?.message); return undefined; });
      photos.push({ id: p.id, lat: where.lat, lon: where.lon, takenAt, colourGrid: p.colourGrid, sky });
    }
    const tally = skyTally({ lat, lon }, readings, photos);
    const thumb = new Map(store.map((p) => [p.id, [...p.derivatives].sort((a, b) => a.width - b.width)[0]?.avif]));
    return json({
      ok: true,
      readings: readings.length,
      lines: tallyLines(tally),
      evenings: tally.evenings.map((e) => ({ ...e, thumbs: e.photoIds.map((id) => thumb.get(id)).filter(Boolean) })),
    });
  } catch (err) {
    console.error('[scout/sky-check] failed', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
