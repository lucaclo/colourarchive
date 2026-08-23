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
import type { Chapter } from './types';

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
