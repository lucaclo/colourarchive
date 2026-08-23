/**
 * A group of similarly-edited reference photographs, once several can be
 * submitted to one match: whether one measures like a different edit from
 * the rest (`analysisOutliers`), and the region averaging `resemble.ts`
 * shares with it (`averageRegions`).
 *
 * The centroid `solveMatch` is actually run against for more than one
 * reference is `mergeReferences` in `solve.ts` — weighted per reference and
 * evidence-weighted per region, which this module's own unweighted average
 * used to do before it existed. Kept here only where nothing else covers it.
 */

import type { HueStats, Moments, PhotoAnalysis, RegionKey, RegionStats } from './types';
import { CLOSE_ENOUGH, rankResemblance, trimSignature, type Resemblance } from './resemble';

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

/** Circular mean of several hue readings, weighted by each one's own
 *  confidence — see `HueStats`: a reading with low `strength` is close to
 *  meaningless and should not pull the average as hard as a coherent one. */
function meanHue(hues: HueStats[]): HueStats {
  let x = 0, y = 0;
  for (const h of hues) {
    const r = (h.mean * Math.PI) / 180;
    x += h.strength * Math.cos(r);
    y += h.strength * Math.sin(r);
  }
  x /= hues.length;
  y /= hues.length;
  const strength = Math.hypot(x, y);
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  // A near-zero resultant means the hues cancelled out — same rule `HueStats`
  // itself documents: don't report a mean that shouldn't be trusted.
  return { mean: strength > 1e-9 ? (angle + 360) % 360 : 0, strength };
}

const meanMoments = (moments: Moments[]): Moments => ({
  mean: mean(moments.map((m) => m.mean)),
  sd: mean(moments.map((m) => m.sd)),
});

function averagePercentiles(curves: number[][]): number[] {
  const usable = curves.filter((c) => c.length > 0);
  if (!usable.length) return [];
  const len = usable[0].length;
  return Array.from({ length: len }, (_, i) => mean(usable.map((c) => c[i] ?? c[c.length - 1])));
}

/** One region, averaged over every analysis that measured it. A reference
 *  missing the region entirely — segmentation found no sky in that frame —
 *  is left out of that region's average, not pulled toward a zero nobody
 *  measured. The same rule `colourCentroid` in similar.ts applies to a
 *  missing colour grid. */
function averageRegion(key: RegionKey, stats: RegionStats[]): RegionStats {
  return {
    key,
    coverage: mean(stats.map((s) => s.coverage)),
    // The most a synthetic region can honestly claim: no single submitted
    // photo supported more than this, so the group shouldn't either.
    sampled: Math.min(...stats.map((s) => s.sampled)),
    L: meanMoments(stats.map((s) => s.L)),
    C: meanMoments(stats.map((s) => s.C)),
    hue: meanHue(stats.map((s) => s.hue)),
    ab: { a: mean(stats.map((s) => s.ab.a)), b: mean(stats.map((s) => s.ab.b)) },
    percentiles: averagePercentiles(stats.map((s) => s.percentiles)),
  };
}

/** Every region across a set of analyses, averaged key by key. Exported —
 *  `resemble.ts`'s own group-comparison shares this rather than a second
 *  implementation of the same averaging. */
export function averageRegions(
  all: Partial<Record<RegionKey, RegionStats>>[],
): Partial<Record<RegionKey, RegionStats>> {
  const keys = new Set<RegionKey>();
  for (const regions of all) for (const key of Object.keys(regions) as RegionKey[]) keys.add(key);
  const out: Partial<Record<RegionKey, RegionStats>> = {};
  for (const key of keys) {
    const present = all.map((r) => r[key]).filter((s): s is RegionStats => Boolean(s));
    if (present.length) out[key] = averageRegion(key, present);
  }
  return out;
}

export interface AnalysisResemblance {
  id: string;
  /** This reference's closest match among the *other* submitted references. */
  nearest: Resemblance;
}

/**
 * How well each reference's grade agrees with the rest of the group — each
 * one compared against whichever *other* reference it measures closest to,
 * reusing `compareLooks` exactly as `resemble.ts` already calibrated it
 * rather than inventing a second distance metric for the same kind of
 * question `similar.ts`'s `groupOutliers` asks about colour.
 *
 * Nearest-neighbour, not a leave-one-out centroid: tried the centroid first,
 * and at the group sizes this actually runs at (three, four references) a
 * single extreme outlier pulls its own exclusion-centroid toward itself
 * hard enough to also implicate the photos that agree with each other — the
 * "others" set for a good reference in a group of three is just the one good
 * peer plus the outlier, average of the two, and that average is not a safe
 * baseline. Comparing pairwise sidesteps the averaging step in the check
 * entirely: a reference with even one genuine peer in the group reads as
 * belonging, regardless of how far the group's actual outlier sits.
 */
export function analysisResemblances(analyses: PhotoAnalysis[]): AnalysisResemblance[] {
  if (analyses.length < 2) return [];
  const signatures = analyses.map((a) => trimSignature(a.id, a.sampledAt, a.regions));
  return analyses.flatMap((a, i) => {
    const others = signatures.filter((_, j) => j !== i);
    const ranked = rankResemblance(signatures[i], others);
    return ranked.length ? [{ id: a.id, nearest: ranked[0] }] : [];
  });
}

/**
 * Which references, if any, measure like a different edit from the rest of
 * the group — `compareLooks`' own `CLOSE_ENOUGH` line, not a threshold
 * invented for this.
 *
 * Needs at least three references: with two, a large distance between them
 * says only that they disagree, not which one is the odd one out, and this
 * refuses to assert one rather than guess. Same rule `similar.ts`'s
 * `groupOutliers` applies to colour.
 */
export function analysisOutliers(analyses: PhotoAnalysis[]): Set<string> {
  if (analyses.length < 3) return new Set();
  const outliers = new Set<string>();
  for (const { id, nearest } of analysisResemblances(analyses)) {
    if (nearest.distance > CLOSE_ENOUGH) outliers.add(id);
  }
  return outliers;
}
