/**
 * Which of my photographs already look like this one?
 *
 * Style Match is built to answer "what would I do to my photo to carry this
 * reference's grade". The archive sitting next to it makes a second question
 * askable, and it is the more interesting one: some evenings the answer is that
 * you already took it. Six frames in the archive already sit where the reference
 * sits, and being shown them is worth more than being handed a preset.
 *
 * This is *not* `similar.ts`. That ranks by subject and composition — a DINOv2
 * embedding, where the light and colour fall in the frame, the aspect ratio. Two
 * photographs of the same alley at different times of day rank as near-identical
 * there and could not be graded more differently. This file deliberately throws
 * every one of those signals away and compares only the grade: the shape of the
 * tone curve, the cast on the whole frame, how saturated it is, how much
 * contrast, and whether the ends of the scale are pulled towards different
 * colours. Nothing here can see what the photograph is *of*.
 *
 * The honest limit, stated up front because it cannot be engineered away: a
 * measurement of a photograph is a measurement of the scene *and* the grade, and
 * this cannot separate them. A brick alley and a beech wood differ in mean
 * colour whatever was done to either in Lightroom. So the parts are reported
 * individually rather than only as a total — a match that agrees on tone and
 * disagrees on cast is telling you something a single number would hide — and
 * nothing here ever claims two photographs were given the same edit. It claims
 * they measure alike, which is all that was measured.
 */

import type { HueStats, Moments, RegionKey, RegionStats } from './types';

/**
 * What a photograph has to carry to be rankable — the whole frame and the three
 * luminance zones, which is exactly the set that needs no segmentation and is
 * therefore available for every photo in the archive at the cost of decoding a
 * thumbnail.
 *
 * Deliberately the same `RegionStats` the reference analysis produces, from the
 * same measurement core, so the two sides of the comparison are the same
 * measurement and not two things that resemble each other.
 */
export interface LookSignature {
  id: string;
  /** Long edge the statistics were taken at, for the record. */
  sampledAt: number;
  regions: Partial<Record<RegionKey, RegionStats>>;
}

/** The regions this reads. Anything else in the signature is ignored. */
export const LOOK_REGIONS: RegionKey[] = [
  'global',
  'zone.shadow',
  'zone.midtone',
  'zone.highlight',
];

/**
 * Scales that turn each measurement into the same currency.
 *
 * Every one is "the amount of this difference that reads as a different edit",
 * so a part of 1.0 means one visible regrade's worth of difference and the five
 * parts can be added. They are judgements, they are written down here rather
 * than buried in the arithmetic, and changing one changes the ranking in a way
 * anybody reading this file can predict.
 */
export const SCALES = {
  /** RMS luminance difference across the percentile curve. 0.04 is a clear regrade. */
  tone: 0.04,
  /** OKLab distance between the two mean colours. 0.02 is a visible cast shift. */
  cast: 0.02,
  /** Difference in mean chroma. */
  saturation: 0.025,
  /** Difference in the spread of lightness — the contrast of the frame. */
  contrast: 0.03,
  /** Difference in how far the highlights are pulled from the shadows in colour. */
  split: 0.02,
} as const;

export type LookPart = keyof typeof SCALES;

export const PART_LABEL: Record<LookPart, string> = {
  tone: 'tone curve',
  cast: 'colour cast',
  saturation: 'saturation',
  contrast: 'contrast',
  split: 'split toning',
};

/**
 * How much each part counts.
 *
 * Tone leads because it is the part of a grade that survives being described:
 * two photographs with the same curve read as the same treatment even when the
 * colour differs, and the reverse is not true. Split toning is weighted lowest
 * not because it matters least but because it is the noisiest — it is a
 * difference of differences, and it is measured over zones that can be nearly
 * empty in a high-key or low-key frame.
 */
export const WEIGHTS: Record<LookPart, number> = {
  tone: 0.34,
  cast: 0.24,
  saturation: 0.17,
  contrast: 0.15,
  split: 0.10,
};

export interface Resemblance {
  id: string;
  /** Total distance. Zero is identical measurements; 1 is about one regrade apart. */
  distance: number;
  /** Each part, in the same units, before weighting. */
  parts: Record<LookPart, number>;
  /** The part that agrees most, and the part that disagrees most. */
  nearest: LookPart;
  furthest: LookPart;
  /** Parts that could not be measured on one side or the other. */
  missing: LookPart[];
  note: string;
}

/* ── The measurements ──────────────────────────────────────────────────────── */

const zeroMoments: Moments = { mean: 0, sd: 0 };

const region = (sig: LookSignature, key: RegionKey): RegionStats | undefined => sig.regions[key];

/**
 * RMS difference between two percentile curves.
 *
 * The curve is the region's tone response at 5% steps, so this is literally how
 * far apart the two photographs' tonal renderings are, averaged over the range.
 * Comparing curve to curve rather than reading Exposure and Contrast off each is
 * the same choice the solver makes: the sliders are descriptions of the curve,
 * and the curve is the thing.
 */
export function toneDistance(a: number[] | undefined, b: number[] | undefined): number | null {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum / a.length);
}

/** Distance between two mean colours in OKLab's a/b plane. */
export const castDistance = (a: { a: number; b: number }, b: { a: number; b: number }): number =>
  Math.hypot(a.a - b.a, a.b - b.b);

/**
 * How far the highlights are pulled away from the shadows, as a vector in a/b.
 *
 * This is what a split-toned grade actually does — cool one end, warm the other
 * — and it is invisible to a global mean, which averages the two back out. Null
 * when either zone is too thin to have a colour worth reading: a frame with
 * almost no shadow pixels has a shadow mean made of noise, and a confident
 * difference computed from it would be noise with a decimal point.
 */
export function splitVector(sig: LookSignature, minSampled = 400): { a: number; b: number } | null {
  const shadow = region(sig, 'zone.shadow');
  const highlight = region(sig, 'zone.highlight');
  if (!shadow || !highlight) return null;
  if (shadow.sampled < minSampled || highlight.sampled < minSampled) return null;
  return { a: highlight.ab.a - shadow.ab.a, b: highlight.ab.b - shadow.ab.b };
}

/* ── The comparison ────────────────────────────────────────────────────────── */

export interface CompareOptions {
  /** Pixels a zone needs before its colour is trusted. */
  minSampled?: number;
}

/**
 * Compare two look signatures.
 *
 * A part that cannot be measured on either side is dropped and named rather than
 * scored as zero: an unmeasured difference is not an agreement, and treating it
 * as one is how a photograph with no shadows to speak of ends up at the top of
 * the list. The total is renormalised over the parts that survived, so a
 * comparison missing split toning is still on the same scale as one that has it,
 * and the caller can see the list of what was skipped.
 */
export function compareLooks(
  reference: LookSignature,
  candidate: LookSignature,
  options: CompareOptions = {},
): Resemblance {
  const minSampled = options.minSampled ?? 400;
  const refGlobal = region(reference, 'global');
  const canGlobal = region(candidate, 'global');

  const parts = {} as Record<LookPart, number>;
  const missing: LookPart[] = [];
  const add = (part: LookPart, raw: number | null) => {
    if (raw == null) missing.push(part);
    else parts[part] = raw / SCALES[part];
  };

  add('tone', toneDistance(refGlobal?.percentiles, canGlobal?.percentiles));
  add('cast', refGlobal && canGlobal ? castDistance(refGlobal.ab, canGlobal.ab) : null);
  add(
    'saturation',
    refGlobal && canGlobal ? Math.abs(refGlobal.C.mean - canGlobal.C.mean) : null,
  );
  add('contrast', refGlobal && canGlobal ? Math.abs(refGlobal.L.sd - canGlobal.L.sd) : null);

  const refSplit = splitVector(reference, minSampled);
  const canSplit = splitVector(candidate, minSampled);
  add('split', refSplit && canSplit ? castDistance(refSplit, canSplit) : null);

  const present = (Object.keys(parts) as LookPart[]).sort((a, b) => parts[a] - parts[b]);
  if (!present.length) {
    return {
      id: candidate.id,
      distance: Infinity,
      parts,
      nearest: 'tone',
      furthest: 'tone',
      missing,
      note: 'Nothing comparable was measured on this photograph.',
    };
  }

  let weighted = 0;
  let totalWeight = 0;
  for (const part of present) {
    weighted += parts[part] * WEIGHTS[part];
    totalWeight += WEIGHTS[part];
  }
  const distance = weighted / totalWeight;

  const nearest = present[0];
  const furthest = present[present.length - 1];
  return {
    id: candidate.id,
    distance,
    parts,
    nearest,
    furthest,
    missing,
    note: resemblanceNote(distance, nearest, furthest, present.length, missing),
  };
}

/**
 * Rank an archive against a reference, closest first.
 *
 * Anything past `limit` is dropped rather than shown greyed out — a ranked list
 * with no cut-off invites reading the bottom of it as a result, and the bottom
 * of this list is "these two photographs have nothing to do with each other".
 */
export function rankResemblance(
  reference: LookSignature,
  candidates: LookSignature[],
  options: CompareOptions & { limit?: number; maxDistance?: number } = {},
): Resemblance[] {
  const ranked = candidates
    .filter((c) => c.id !== reference.id)
    .map((c) => compareLooks(reference, c, options))
    .filter((r) => Number.isFinite(r.distance))
    .sort((a, b) => a.distance - b.distance);
  const maxDistance = options.maxDistance;
  const capped = maxDistance == null ? ranked : ranked.filter((r) => r.distance <= maxDistance);
  return options.limit == null ? capped : capped.slice(0, options.limit);
}

/**
 * Below this the two measure like the same treatment. Named so the UI and the
 * sentences agree on where the line is.
 */
export const CLOSE_ENOUGH = 0.75;
/** Past this they are not worth putting next to each other. */
export const TOO_FAR = 2.5;

function resemblanceNote(
  distance: number,
  nearest: LookPart,
  furthest: LookPart,
  count: number,
  missing: LookPart[],
): string {
  const gap =
    missing.length === 0
      ? ''
      : ` ${missing.map((m) => PART_LABEL[m]).join(' and ')} could not be compared, so ${count === 1 ? 'this rests on one measurement' : `this rests on the other ${count}`}.`;

  if (distance <= CLOSE_ENOUGH) {
    return `Measures like the same treatment — closest on ${PART_LABEL[nearest]}, furthest apart on ${PART_LABEL[furthest]}.${gap} Alike in the numbers; not a claim about how either was edited.`;
  }
  if (distance <= TOO_FAR) {
    return `In the same territory. Agrees on ${PART_LABEL[nearest]}, parts company on ${PART_LABEL[furthest]}.${gap}`;
  }
  return `Different photographs. The nearest they come is ${PART_LABEL[nearest]}.${gap}`;
}

/** "tone curve 0.4 · colour cast 1.9" — the parts, worst last, for the panel. */
export function describeParts(resemblance: Resemblance): string {
  return (Object.keys(resemblance.parts) as LookPart[])
    .sort((a, b) => resemblance.parts[a] - resemblance.parts[b])
    .map((part) => `${PART_LABEL[part]} ${resemblance.parts[part].toFixed(1)}`)
    .join(' · ');
}

/** A signature carrying only the regions this file reads, for storing. */
export function trimSignature(id: string, sampledAt: number, regions: Partial<Record<RegionKey, RegionStats>>): LookSignature {
  const kept: Partial<Record<RegionKey, RegionStats>> = {};
  for (const key of LOOK_REGIONS) if (regions[key]) kept[key] = regions[key];
  return { id, sampledAt, regions: kept };
}

/** An empty region, for tests and for a photograph that measured nothing. */
export const emptyRegion = (key: RegionKey): RegionStats => ({
  key,
  coverage: 0,
  sampled: 0,
  L: zeroMoments,
  C: zeroMoments,
  hue: { mean: 0, strength: 0 } as HueStats,
  ab: { a: 0, b: 0 },
  percentiles: [],
});
