/**
 * Combining several similarly-edited reference photographs into one
 * measurement, for the same reason `similar.ts`'s `rankSimilarGroup` averages
 * a group's colour rather than its embeddings: the grade is the thing every
 * submitted photo shares, and averaging is what makes it reinforce while
 * each photo's own scene content — different light, different subject —
 * partly cancels out.
 *
 * `solveMatch` never touches raw pixels; it reads a `PhotoAnalysis`. That
 * means a group centroid can be built by averaging N *measurements* and
 * solving once against the result, rather than solving N times and averaging
 * N sets of Lightroom values. The latter has no precedent here and no
 * obvious meaning: each solve's later stages (region caps, masks) are
 * residuals computed against that one photo's own running state, and are not
 * obviously combinable after the fact. Averaging the measurement first, the
 * same choice `similar.ts` already made, is the one with a clear meaning.
 */

import { BASELINE_FIDELITY, BASELINE_LABEL } from './types';
import type {
  BaselineMode,
  HslBandStats,
  HueStats,
  Moments,
  PhotoAnalysis,
  RegionKey,
  RegionStats,
  TextureStats,
  VignetteStats,
} from './types';
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
 *  `analysisResemblances` below needs the same averaging for a leave-one-out
 *  centroid, and duplicating it would risk the two drifting apart. */
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

function averageHslBands(all: HslBandStats[][]): HslBandStats[] {
  const withBands = all.filter((b) => b.length > 0);
  if (!withBands.length) return [];
  return withBands[0].map((_, i) => {
    const bands = withBands.map((b) => b[i]).filter((b): b is HslBandStats => Boolean(b));
    return {
      key: bands[0].key,
      weight: mean(bands.map((b) => b.weight)),
      chroma: mean(bands.map((b) => b.chroma)),
      L: mean(bands.map((b) => b.L)),
      // Weighted by each band's own `weight` — a band that is barely present
      // in a photo has a hue reading close to noise (see `HslBandStats.hue`).
      hue: meanHue(bands.map((b) => ({ mean: b.hue, strength: b.weight }))).mean,
    };
  });
}

/** Texture (grain/acutance/…) averaged over references whose measurement was
 *  usable. If none were, the group's is honestly unusable too, with a reason
 *  that says why rather than a silent zero. */
function averageTexture(all: TextureStats[]): TextureStats {
  const usable = all.filter((t) => t.usable);
  if (!usable.length) {
    const first = all[0];
    return {
      usable: false,
      blocked: first?.blocked ?? 'none',
      reason: `No reference had usable texture data (${all.map((t) => t.reason ?? t.blocked).join('; ')}).`,
      normalised: false,
      nativeSize: first?.nativeSize ?? { width: 0, height: 0 },
      grain: 0,
      grainSize: 0,
      acutance: 0,
      flatToEdge: 0,
      measuredAt: first?.measuredAt ?? { width: 0, height: 0 },
    };
  }
  return {
    usable: true,
    blocked: 'none',
    normalised: usable.some((t) => t.normalised),
    nativeSize: {
      width: Math.round(mean(usable.map((t) => t.nativeSize.width))),
      height: Math.round(mean(usable.map((t) => t.nativeSize.height))),
    },
    grain: mean(usable.map((t) => t.grain)),
    grainSize: mean(usable.map((t) => t.grainSize)),
    acutance: mean(usable.map((t) => t.acutance)),
    flatToEdge: mean(usable.map((t) => t.flatToEdge)),
    measuredAt: {
      width: Math.round(mean(usable.map((t) => t.measuredAt.width))),
      height: Math.round(mean(usable.map((t) => t.measuredAt.height))),
    },
  };
}

/** Vignette, same "average over usable, honest zero if none" rule as texture. */
function averageVignette(all: VignetteStats[]): VignetteStats {
  const usable = all.filter((v) => v.usable);
  if (!usable.length) return { falloffStops: 0, symmetry: 0, usable: false };
  return {
    falloffStops: mean(usable.map((v) => v.falloffStops)),
    symmetry: mean(usable.map((v) => v.symmetry)),
    usable: true,
  };
}

/** The least reliable baseline in the group — see `BASELINE_FIDELITY`. Mirrors
 *  `computeConfidence`'s own `Math.min` of two baselines in solve.ts: a
 *  group's confidence should never be inflated by its best-measured member
 *  covering for its worst. */
function worstBaseline(baselines: BaselineMode[]): BaselineMode {
  return baselines.reduce((worst, b) => (BASELINE_FIDELITY[b] < BASELINE_FIDELITY[worst] ? b : worst));
}

/**
 * The group's centroid measurement — what `solveMatch` is actually run
 * against for more than one reference.
 *
 * A single reference is returned unchanged, not merely equal to it: same
 * `id`, same object. `runMatch`'s cache key is built from the reference
 * file's own byte hash, and a group of one has to resolve to *the same*
 * cache entry a plain single-reference match already produced, or every
 * existing cached match goes stale the moment this ships.
 */
export function averageAnalyses(analyses: PhotoAnalysis[]): PhotoAnalysis {
  if (analyses.length === 1) return analyses[0];
  const baseline = worstBaseline(analyses.map((a) => a.baseline));
  const mixedBaseline = new Set(analyses.map((a) => a.baseline)).size > 1;
  return {
    id: analyses.map((a) => a.id).sort().join('+'),
    filename: `${analyses.length} references, blended`,
    baseline,
    baselineNote: mixedBaseline
      ? `Blended from ${analyses.length} references measured at different baselines; shown at the least reliable of them (${BASELINE_LABEL[baseline]}).`
      : analyses[0].baselineNote,
    width: Math.round(mean(analyses.map((a) => a.width))),
    height: Math.round(mean(analyses.map((a) => a.height))),
    sampledAt: Math.round(mean(analyses.map((a) => a.sampledAt))),
    regions: averageRegions(analyses.map((a) => a.regions)),
    texture: averageTexture(analyses.map((a) => a.texture)),
    vignette: averageVignette(analyses.map((a) => a.vignette)),
    hslBands: averageHslBands(analyses.map((a) => a.hslBands)),
    timings: {},
    warnings: [...new Set(analyses.flatMap((a) => a.warnings))],
  };
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
