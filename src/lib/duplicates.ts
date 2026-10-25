import { embeddingDistance } from './similar';
import type { Photo } from './types';

/** One likely-duplicate/burst group, scoped to a single chapter. */
export interface DuplicateGroup {
  /** Stable for one call's results only — `${chapterKey}-${index}` — never persisted. */
  key: string;
  chapterKey: string;
  ids: string[];
}

/**
 * Embedding distance ceiling for "the same shot, or a burst of it" — see the
 * module comment for why this is an absolute number rather than
 * `clusterByEmbedding`'s percentile-of-the-set approach.
 *
 * Measured against this archive's own 82 photos: a confirmed four-frame
 * burst (same subject, 19:38-19:47, corroborated by EXIF below) sits at
 * 0.047-0.154. The next-closest pair anywhere in the archive was a
 * same-chapter pair shot on two different days 20.5 hours apart — a
 * revisit, not a duplicate, at 0.24. 0.2 sits in the real gap between those
 * two measurements: comfortably above every distance the confirmed burst
 * produced, comfortably below the confirmed false positive. One archive is
 * not a calibration, so treat this the way `CLUSTER_PERCENTILE` in
 * similar.ts is treated — a reasoned starting point, not a proven constant.
 */
const MAX_DUPLICATE_DISTANCE = 0.2;

/**
 * A real burst happens within minutes, not hours — the confirmed burst this
 * was measured against spans nine. Thirty is a generous ceiling on "still
 * the same standing session", chosen so the gate only ever removes a
 * pairing that embedding similarity alone got wrong (see below), never one
 * it got right.
 */
const TIME_WINDOW_MS = 30 * 60 * 1000;

/**
 * With no capture time to confirm a session (film, or EXIF stripped), the
 * colour-and-layout embedding is the only witness, and on its own it pairs
 * places rather than shots: two different beaches (IMG_4797, IMG_4801) and
 * two different temple frames passed it. CLIP, which reads what is in the
 * picture, puts those at 0.84–0.85 and every confirmed burst at 0.81–0.95 —
 * so it can't decide a burst alone either, but where time is silent a
 * demand for 0.9 keeps the near-identical frames and drops the revisits.
 */
const MIN_CLIP_WITHOUT_TIME = 0.9;

const hasTime = (p: Photo): boolean => Boolean(p.exif?.capturedAt) && !Number.isNaN(Date.parse(p.exif!.capturedAt!));

function clipAgrees(a: Photo, b: Photo): boolean {
  if (hasTime(a) && hasTime(b)) return true;   // time already decided it
  const va = a.clipEmbedding, vb = b.clipEmbedding;
  if (!va || !vb || va.length !== vb.length) return true;  // no second witness: as before
  let dot = 0;
  for (let i = 0; i < va.length; i++) dot += va[i] * vb[i];
  return dot >= MIN_CLIP_WITHOUT_TIME;
}

/**
 * Whether two photos' capture times are consistent with the same session —
 * or silently uninformative, which is not the same as consistent, but is
 * treated the same way here because there is no evidence to act on either
 * side. Film carries no real capture time (the scanner's own EXIF, not the
 * subject's), and even digital EXIF is sometimes absent — in both cases this
 * returns true rather than let missing data masquerade as "known different
 * times", which would silently break apart every film duplicate.
 */
function timeCompatible(a: Photo, b: Photo): boolean {
  const ta = a.exif?.capturedAt ? Date.parse(a.exif.capturedAt) : NaN;
  const tb = b.exif?.capturedAt ? Date.parse(b.exif.capturedAt) : NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return true;
  return Math.abs(ta - tb) <= TIME_WINDOW_MS;
}

/**
 * Groups of photos within one chapter that look like the same shot, or a
 * burst of it.
 *
 * This is deliberately its own pairwise pass rather than a reuse of
 * `clusterByEmbedding` (similar.ts). That function ranks a set's pairs
 * against *its own* typical spread — the right question for "which of these
 * references share an edit", where the set is a small, curated board. It is
 * the wrong question here: a real chapter runs to a few dozen photos, and a
 * fixed *percentage* of a chapter's own pairs grows roughly with the square
 * of its size, while the number of edges needed to chain a chapter into one
 * connected blob under single-link clustering grows only linearly with it.
 * Past roughly eight photos the two cross, and every chapter above that size
 * single-links into one giant "duplicate" group regardless of what is
 * actually in it — confirmed by running it on this archive's own 20-photo
 * "orange" chapter, which produced a 10-photo "duplicate" group. An absolute
 * distance ceiling doesn't have that failure mode: it does not get looser as
 * the chapter it's applied to gets bigger.
 *
 * Single-link within that ceiling, same principle `clusterByEmbedding` uses
 * for its own board-sized clusters: a three-frame burst where the first and
 * third frames alone would sit outside the window is still one session once
 * the middle frame bridges them, in distance and in time alike.
 *
 * Scoped per chapter for a second, separate reason: a real burst was shot in
 * one place in one sitting, and chapters are grouped by dominant colour —
 * near-identical frames share a dominant colour almost by definition, so a
 * genuine duplicate essentially never crosses a chapter boundary, while two
 * unrelated photos that happen to share a subject can.
 *
 * Photos with no `embedding` (never ingested, or ingested before it existed)
 * are left out entirely — there is nothing to compare them against, and
 * treating "unknown" as "distinct" would be a guess this function has no
 * basis for.
 */
export function duplicateGroups(chapters: Array<{ key: string; photos: Photo[] }>): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  for (const ch of chapters) {
    const ps = ch.photos.filter((p): p is Photo & { embedding: number[] } => Boolean(p.embedding?.length));
    if (ps.length < 2) continue;

    const parent = new Map(ps.map((p) => [p.id, p.id] as const));
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      return root;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        if (embeddingDistance(ps[i].embedding, ps[j].embedding) <= MAX_DUPLICATE_DISTANCE && timeCompatible(ps[i], ps[j]) && clipAgrees(ps[i], ps[j])) {
          union(ps[i].id, ps[j].id);
        }
      }
    }

    const byRoot = new Map<string, Photo[]>();
    for (const p of ps) {
      const root = find(p.id);
      const bucket = byRoot.get(root);
      if (bucket) bucket.push(p);
      else byRoot.set(root, [p]);
    }
    let i = 0;
    for (const bucket of byRoot.values()) {
      if (bucket.length < 2) continue;
      groups.push({ key: `${ch.key}-${i++}`, chapterKey: ch.key, ids: bucket.map((p) => p.id) });
    }
  }
  return groups;
}
