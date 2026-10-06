/**
 * Photos that sit close to a chapter boundary — issue #106.
 *
 * Chapters are decided by two hard edges in `classify` (color.ts): a chroma
 * cut-off below which a frame is achromatic, and the midpoint between two hue
 * anchors. Both are single numbers, so two frames a viewer would call the
 * same colour can land either side of one — chroma 0.034 is grey, 0.036 is
 * orange. The edges stay hard on purpose (a photo must land in the same
 * chapter forever); what this adds is the ability to *see* which photos are
 * standing on one, so they are the ones you check by eye.
 *
 * A borderline verdict names the chapter on the other side of the edge, not
 * just "near a boundary", because the only useful next action is "move it
 * there" — and that needs a destination.
 *
 * The margins are deliberately generous relative to how precisely the
 * dominant colour is measured. The measurement quantises and discards pixels
 * (dominant.ts), so a frame 0.004 of chroma from the edge is genuinely
 * ambiguous, not merely close.
 *
 * Pure. Judges the *automatic* classification only — a photo you have moved
 * by hand is your decision, and flagging it again would be noise.
 */

import {
  ACHROMATIC_CHROMA, ACHROMATIC_KEY, ANCHORS, nearestAnchor, oklchCss, type OKLCH,
} from './color';

/** Chroma within this of the achromatic cut-off reads as borderline. */
export const CHROMA_MARGIN = 0.006;
/** Hue within this many degrees of the midpoint between two anchors. */
export const HUE_MARGIN = 4;

export interface Borderline {
  /** The base chapter key on the other side of the edge. */
  alternative: string;
  /** Which edge: the grey/colour cut-off, or the line between two hues. */
  edge: 'chroma' | 'hue';
  /** How far from the edge, in the edge's own units (chroma, or degrees). */
  distance: number;
}

const circDist = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * Whether a photo's measured colour sits near an edge, and what is on the
 * other side. The chroma edge is checked first: a frame that is barely
 * coloured at all is a grey-or-not question before it is a which-hue one.
 */
export function borderlineOf(oklch: OKLCH): Borderline | null {
  const fromCut = oklch.C - ACHROMATIC_CHROMA;
  if (Math.abs(fromCut) < CHROMA_MARGIN) {
    return {
      // Below the cut it is filed as grey, so the alternative is its hue;
      // above, it is filed by hue, so the alternative is grey.
      alternative: fromCut < 0 ? nearestAnchor(oklch.H).slug : ACHROMATIC_KEY,
      edge: 'chroma',
      distance: round(Math.abs(fromCut), 4),
    };
  }
  if (fromCut < 0) return null; // clearly grey — hue is not meaningful

  const byDistance = ANCHORS
    .map((a) => ({ slug: a.slug, d: circDist(oklch.H, a.H) }))
    .sort((a, b) => a.d - b.d);
  const [nearest, second] = byDistance;
  // The edge is the midpoint of the two nearest anchors, so the distance to
  // it is half the difference in distance to each.
  const toEdge = (second.d - nearest.d) / 2;
  if (toEdge >= HUE_MARGIN) return null;
  return { alternative: second.slug, edge: 'hue', distance: round(toEdge, 1) };
}

export interface ChapterChoice {
  key: string;
  name: string;
  /** A CSS swatch for the picker — the anchor's own hue, not any photo's. */
  swatch: string;
}

/**
 * Every base chapter a photo can be moved to, in wheel order, named as the
 * archive names them (so a renamed "Camel" shows as Camel).
 */
export function chapterChoices(renames: Record<string, string> = {}): ChapterChoice[] {
  return [
    { key: ACHROMATIC_KEY, name: renames[ACHROMATIC_KEY] ?? 'Grey', swatch: oklchCss({ L: 0.62, C: 0, H: 0 }) },
    ...ANCHORS.map((a) => ({
      key: a.slug,
      name: renames[a.slug] ?? a.name,
      swatch: oklchCss({ L: 0.68, C: 0.13, H: a.H }),
    })),
  ];
}

/** Whether a base key is one a photo can actually be filed under. */
export function isChapterBase(key: string): boolean {
  return key === ACHROMATIC_KEY || ANCHORS.some((a) => a.slug === key);
}

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;
