/**
 * Colours the archive doesn't have yet.
 *
 * Every chapter already sits at one of a fixed set of perceptual hue anchors
 * (`ANCHORS` in `color.ts`) — the same wheel the spectrum scrubber and the
 * cover aurora paint from. An anchor with no chapter isn't a rounding
 * artefact, it's a hue the shutter has never actually recorded: the wheel has
 * eight fixed positions and the archive has only filled some of them.
 *
 * That makes "what's missing" a much smaller question than it sounds — not a
 * fuzzy gap in a continuous hue histogram, but a lookup against a fixed,
 * already-drawn wheel. A hue is either represented or it is a gap; there is
 * no in-between to fit a threshold to.
 *
 * "Thin" is the honest middle case: an anchor with a chapter, but a small one
 * next to the busiest. Reported separately from a hard gap (zero photos)
 * because they are different claims — one says "never shot", the other says
 * "shot rarely" — and collapsing them into one list would let the softer
 * claim borrow the harder one's certainty.
 */

import { ACHROMATIC_KEY, ANCHORS, baseKeyOf } from './color';
import { GENRES, GENRE_LABEL } from './types';
import type { Chapter, Genre, Photo } from './types';

/** Below this share of the busiest anchor's count, a present anchor still reads as thin. */
const THIN_SHARE = 0.15;

export type GapKind = 'missing' | 'thin';

export interface ColourGap {
  /** The anchor's own slug — `chapterKey(base, band)`'s base, and a stable id. */
  anchorKey: string;
  anchorName: string;
  /** The hue a shoot would need to land near, degrees. */
  targetHue: number;
  kind: GapKind;
  /** Photos across every band of this anchor (deep + mid + pale), 0 for a hard gap. */
  photoCount: number;
  note: string;
}

/**
 * Which hue anchors the archive has never filled, or has barely filled.
 *
 * Achromatic is excluded — it isn't a hue, and "missing grey" isn't a shoot
 * anyone would plan for. Ordered round the wheel (`ANCHORS`' own order),
 * gaps before thin ones don't matter here; the caller sorts however the view
 * needs.
 */
export function findColourGaps(chapters: Chapter[]): ColourGap[] {
  const countByBase = new Map<string, number>();
  for (const ch of chapters) {
    const base = baseKeyOf(ch.key);
    if (base === ACHROMATIC_KEY) continue;
    countByBase.set(base, (countByBase.get(base) ?? 0) + ch.photos.length);
  }
  const busiest = Math.max(0, ...countByBase.values());

  const gaps: ColourGap[] = [];
  for (const anchor of ANCHORS) {
    const count = countByBase.get(anchor.slug) ?? 0;
    if (count === 0) {
      gaps.push({
        anchorKey: anchor.slug,
        anchorName: anchor.name,
        targetHue: anchor.H,
        kind: 'missing',
        photoCount: 0,
        note: `Never shot: no ${anchor.name.toLowerCase()} in the archive.`,
      });
    } else if (busiest > 0 && count / busiest < THIN_SHARE) {
      gaps.push({
        anchorKey: anchor.slug,
        anchorName: anchor.name,
        targetHue: anchor.H,
        kind: 'thin',
        photoCount: count,
        note: `Thin: only ${count} photo${count === 1 ? '' : 's'} of ${anchor.name.toLowerCase()}, against ${busiest} in the biggest chapter.`,
      });
    }
  }
  return gaps;
}

/** An anchor needs at least this many genre-labelled photos before its genre
 *  mix means anything — "1 photo, missing 3 of 4 genres" isn't a blind spot,
 *  it's a sample size. `findColourGaps`'s own thin/missing split already
 *  covers an anchor this thin from the colour side alone. */
const MIN_GENRE_SAMPLE = 3;

export interface GenreColourGap {
  genre: Genre;
  anchorKey: string;
  anchorName: string;
  targetHue: number;
  /** How many genre-labelled photos exist at this anchor, across every
   *  genre — the sample size the absence is measured against. */
  anchorTotal: number;
  note: string;
}

/**
 * Genres never shot in a hue the archive otherwise shoots plenty of — a
 * different claim from `findColourGaps`, which is blind to genre entirely.
 * "You have 40 blue landscapes and zero blue portraits" is invisible to a
 * pure hue count (blue is obviously not a gap) and invisible to a pure
 * genre count (portraits aren't rare overall); it only shows up once the
 * two are crossed.
 *
 * Scoped to anchors with enough genre-labelled photos to say anything (see
 * `MIN_GENRE_SAMPLE`) — film carries no genre by default and a photo with
 * no genre at all is left out rather than silently counted as "not this
 * genre", which would manufacture gaps out of missing labels rather than
 * missing photographs.
 */
export function findGenreColourGaps(photos: Photo[]): GenreColourGap[] {
  const byAnchor = new Map<string, Photo[]>();
  for (const p of photos) {
    if (!p.genre) continue;
    const base = baseKeyOf(p.chapter);
    if (base === ACHROMATIC_KEY) continue;
    if (!byAnchor.has(base)) byAnchor.set(base, []);
    byAnchor.get(base)!.push(p);
  }

  const gaps: GenreColourGap[] = [];
  for (const anchor of ANCHORS) {
    const ps = byAnchor.get(anchor.slug);
    if (!ps || ps.length < MIN_GENRE_SAMPLE) continue;
    const present = new Set(ps.map((p) => p.genre));
    for (const genre of GENRES) {
      if (present.has(genre)) continue;
      gaps.push({
        genre,
        anchorKey: anchor.slug,
        anchorName: anchor.name,
        targetHue: anchor.H,
        anchorTotal: ps.length,
        note: `${ps.length} ${anchor.name.toLowerCase()} photo${ps.length === 1 ? '' : 's'} in the archive, none of them ${GENRE_LABEL[genre].toLowerCase()}.`,
      });
    }
  }
  return gaps;
}
