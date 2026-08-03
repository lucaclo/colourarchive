import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readInspStore } from '../../../lib/inspiration';
import { readStore } from '../../../lib/manifest';
import { INSPIRATION_DIR, IMG_DIR, PHOTOS_DIR, imgUrl } from '../../../lib/paths';
import { looksFor, measureLook } from '../../../lib/match/looks';
import { TOO_FAR, describeParts, rankResemblance } from '../../../lib/match/resemble';
import type { Photo } from '../../../lib/types';

export const prerender = false;

// "Which of my photographs already look like this one?"
//
// The reference is measured from its *original*, exactly as the analyse route
// measures it, because a re-encoded copy folds the encoder's artefacts into the
// numbers. The archive is measured from derivatives, which is a different
// choice made for a stated reason — see `looks.ts`. The statistics involved are
// distributions over pixels and survive the resize; nothing here reads grain.

/** How many to hand back. A short list is the point of the feature. */
const DEFAULT_LIMIT = 8;

export const GET: APIRoute = async ({ url }) => {
  const refId = String(url.searchParams.get('ref') || '').trim();
  const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.min(40, Math.max(1, Math.floor(limitRaw))) : DEFAULT_LIMIT;

  if (!refId) return json({ ok: false, error: 'Pick a reference first.' }, 400);

  try {
    const [insp, archive] = await Promise.all([readInspStore(), readStore()]);
    const inspItem = insp.find((p) => p.id === refId);
    const archiveItem = archive.find((p) => p.id === refId);
    const ref = inspItem ?? archiveItem;
    if (!ref) return json({ ok: false, error: 'That reference no longer exists.' }, 404);

    const refPath = path.join(inspItem ? INSPIRATION_DIR : PHOTOS_DIR, ref.filename);
    try {
      await fs.access(refPath);
    } catch {
      return json({ ok: false, error: 'The reference original is missing from disk.' }, 410);
    }

    const [reference, archiveLooks] = await Promise.all([
      measureLook(ref.id, refPath),
      looksFor(archive.map(sourceFor).filter((r): r is { id: string; imagePath: string } => r != null)),
    ]);

    const ranked = rankResemblance(reference, archiveLooks.signatures, {
      limit,
      maxDistance: TOO_FAR,
    });
    const byId = new Map(archive.map((p) => [p.id, p]));

    return json({
      ok: true,
      // How much of the archive this was actually able to look at. A result
      // drawn from two thirds of the archive is a different statement from one
      // drawn from all of it, and the page says which it has.
      considered: archiveLooks.signatures.length,
      archiveSize: archive.length,
      measuredNow: archiveLooks.measured,
      unreadable: archiveLooks.failed.length,
      matches: ranked
        .map((r) => {
          const photo = byId.get(r.id);
          if (!photo) return null;
          return {
            id: r.id,
            filename: photo.filename,
            chapter: photo.chapter,
            width: photo.width,
            height: photo.height,
            placeholder: photo.placeholder,
            thumb: thumbFor(photo),
            distance: Number(r.distance.toFixed(3)),
            parts: r.parts,
            partsText: describeParts(r),
            nearest: r.nearest,
            furthest: r.furthest,
            missing: r.missing,
            note: r.note,
          };
        })
        .filter(Boolean),
    });
  } catch (err) {
    console.error('[match/resemble] failed', err);
    return json({ ok: false, error: 'Could not compare against the archive.' }, 500);
  }
};

/**
 * Where to measure an archive photo from.
 *
 * The smallest derivative that is still big enough to give a smooth percentile
 * curve. Photos with no derivative at all — legacy records, a half-finished
 * ingest — are skipped rather than measured from the original: reading a 50 MB
 * RAW here would turn a two-second scan into a very long one, and the point of
 * this route is that it answers while you are still looking at the reference.
 */
function sourceFor(photo: Photo): { id: string; imagePath: string } | null {
  const derivative = [...photo.derivatives].sort((a, b) => a.width - b.width).find((d) => d.width >= 640)
    ?? [...photo.derivatives].sort((a, b) => b.width - a.width)[0];
  if (!derivative) return null;
  return { id: photo.id, imagePath: path.join(IMG_DIR, path.basename(derivative.avif)) };
}

/** Smallest derivative, for the thumbnail strip. */
function thumbFor(photo: Photo): string | null {
  const derivative = [...photo.derivatives].sort((a, b) => a.width - b.width)[0];
  return derivative ? imgUrl(path.basename(derivative.avif)) : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
