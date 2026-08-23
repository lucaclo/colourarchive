/**
 * A chapter's settled look — issue #61.
 *
 * Style Match already answers "what would I do to my photo to carry this
 * reference's grade" for one photo against another (`solve.ts`), and
 * `resemble.ts` already answers "do these two measure like the same edit"
 * with a real distance and a calibrated line (`CLOSE_ENOUGH`, `TOO_FAR`).
 * Neither had ever been run across a whole chapter at once. This is that:
 * every photo already in a chapter, measured the same way `resemble.ts`
 * measures the archive for "which of my photos already look like this",
 * averaged into one signature — the chapter's DNA — with the same
 * `averageRegions` `group.ts` already uses to merge several *references*
 * into one shared grade. A chapter is exactly that: several photographs
 * that happen to share a grade, just discovered after the fact instead of
 * submitted together on purpose.
 *
 * Scoring a new photo against that DNA reuses `compareLooks` unchanged —
 * the calibration a chapter's own look sits on is not a new one invented
 * for this, it is the one the rest of Style Match already trusts.
 *
 * Deterministic and local, per the feature's own locked decisions: no
 * network, no LLM, the same measurement core throughout.
 */

import { averageRegions } from './group';
import { compareLooks, trimSignature, CLOSE_ENOUGH, TOO_FAR, type LookSignature, type Resemblance } from './resemble';

/** Fewer than this many *other* photos in a chapter and there is no settled
 *  look to speak of yet — a DNA of two photographs is just those two
 *  photographs, not a chapter's habit. Refuse rather than guess, the same
 *  rule `analysisOutliers` applies to a group of references. */
export const MIN_CHAPTER_PHOTOS = 3;

/**
 * A chapter's DNA — the mean of every measured photo in it, region by
 * region, in the same OKLab/percentile-aware way `group.ts` already merges
 * several references. Null when there is nothing to average.
 */
export function chapterDna(signatures: LookSignature[]): LookSignature | null {
  if (!signatures.length) return null;
  const sampledAt = Math.round(signatures.reduce((sum, sig) => sum + sig.sampledAt, 0) / signatures.length);
  return trimSignature('chapter-dna', sampledAt, averageRegions(signatures.map((sig) => sig.regions)));
}

export type ChapterFitVerdict = 'keeps' | 'borderline' | 'new-look';

export interface ChapterFit {
  resemblance: Resemblance;
  verdict: ChapterFitVerdict;
  /** One sentence, in the same idiom `resemblance.note` already uses. */
  note: string;
}

const VERDICT_WORD: Record<ChapterFitVerdict, string> = {
  keeps: 'keeps the chapter’s look',
  borderline: 'sits between this chapter’s look and a new one',
  'new-look': 'would start a new look for this chapter',
};

/**
 * How a photo's own look measures against a chapter's DNA.
 *
 * `compareLooks`' existing `CLOSE_ENOUGH`/`TOO_FAR` lines decide the verdict
 * — thresholds already calibrated for "do these two measure like the same
 * edit", not a boundary invented fresh for chapters.
 */
export function scoreAgainstChapter(signature: LookSignature, dna: LookSignature): ChapterFit {
  const resemblance = compareLooks(dna, signature);
  const verdict: ChapterFitVerdict =
    resemblance.distance <= CLOSE_ENOUGH ? 'keeps' : resemblance.distance >= TOO_FAR ? 'new-look' : 'borderline';
  return { resemblance, verdict, note: `${VERDICT_WORD[verdict]} — ${resemblance.note}` };
}
