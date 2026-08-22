import type { Photo } from './types';
import type { OKLCH } from './color';

// Similarity, split into two independent axes so the UI slider can blend them:
//   • composition = DINOv2 embedding (subject/scene + structure) + tonal layout
//     (where light/dark sit) + aspect (orientation).
//   • colour      = colour-layout grid (where hues sit) + dominant colour.
// Both are returned min-max-normalised to [0,1] over the candidate set (0 =
// closest), so the client can compute final = (1-w)·comp + w·colour and re-rank
// live as the slider moves.
//
// Everything below is built around a *group* of references, not a single one
// — submitting several similarly-edited photos together is meant to sharpen
// the colour signal, not blur it. The two axes are aggregated differently on
// purpose:
//   • Colour is compared against the group's own centroid (mean colour grid,
//     mean dominant colour). Different subjects under the same edit disagree
//     on everything else but agree on the grade, so averaging is exactly what
//     should make the *edit* stand out while the per-photo noise cancels out.
//   • Composition is compared against whichever single reference is closest,
//     not an average. There is no such thing as "the average subject" of a
//     portrait and a landscape — blending their embeddings lands on a point
//     in embedding space that corresponds to nothing real, and ranking
//     candidates by distance to nothing is worse than ranking by distance to
//     an actual photo. A candidate counts as compositionally close if it
//     resembles *any* submitted reference.
// `rankSimilar(ref, candidates)` is the single-reference case, defined as
// `rankSimilarGroup([ref], candidates)` — with one reference, "closest of the
// group" and "mean of the group" both collapse to that reference's own
// values, so the two are provably identical rather than merely tested equal.

/** A colour grid is a 4x4 spatial grid, [L,a,b] per cell — see `signature.ts`. */
const GRID_LENGTH = 48;

const dot = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const toLab = (o: OKLCH): [number, number, number] => {
  const r = (o.H * Math.PI) / 180;
  return [o.L, o.C * Math.cos(r), o.C * Math.sin(r)];
};
/** Element-wise mean of same-length rows. Undefined for an empty input, never NaN. */
const mean = (rows: number[][]): number[] | undefined => {
  if (!rows.length) return undefined;
  const len = rows[0].length;
  const out = new Array(len).fill(0);
  for (const row of rows) for (let i = 0; i < len; i++) out[i] += row[i] / rows.length;
  return out;
};

export interface SimRow { photo: Photo; comp: number; col: number; }

/** The group's shared colour — the one thing every reference is compared against for `col`. */
interface ColourCentroid {
  /** Mean 4x4 OKLab grid over refs that have a well-formed one; undefined if none do. */
  grid?: number[];
  /** Mean dominant colour, in Lab — `oklch` is never optional, so this always exists. */
  lab: [number, number, number];
}

function colourCentroid(refs: Photo[]): ColourCentroid {
  const grids = refs.map((r) => r.colourGrid).filter((g): g is number[] => Boolean(g) && g!.length === GRID_LENGTH);
  return {
    grid: grids.length ? mean(grids) : undefined,
    lab: mean(refs.map((r) => toLab(r.oklch))) as [number, number, number],
  };
}

/**
 * `compRaw` between one candidate and one reference — the composition half of
 * what `rankSimilar` always computed, factored out so the group path can take
 * the closest reference rather than reimplementing the distance math.
 */
function compAgainst(ref: Photo, c: Photo): number {
  // Embedding distance (0 identical … 2 opposite); large if either missing.
  let embDist = 2;
  if (ref.embedding && c.embedding && ref.embedding.length === c.embedding.length) {
    embDist = 1 - dot(ref.embedding, c.embedding);
  }
  // Tonal layout from the L channel of the 4x4 OKLab grid.
  let toneDist = 0;
  if (ref.colourGrid && c.colourGrid && ref.colourGrid.length === c.colourGrid.length) {
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const dL = ref.colourGrid[i * 3] - c.colourGrid[i * 3];
      sum += dL * dL;
    }
    toneDist = Math.sqrt(sum);
  }
  // Orientation.
  const arRef = ref.height / (ref.width || 1);
  const arC = c.height / (c.width || 1);
  const aspectDist = Math.abs(Math.log((arC || 1) / (arRef || 1)));

  return 0.6 * embDist + 0.25 * toneDist + 0.15 * aspectDist;
}

/** `colRaw` between one candidate and the group's colour centroid. */
function colAgainst(centroid: ColourCentroid, c: Photo): number {
  // Colour layout from the a/b channels of the 4x4 OKLab grid.
  let colLayout = 0;
  if (centroid.grid && c.colourGrid && c.colourGrid.length === centroid.grid.length) {
    let sum = 0;
    for (let i = 0; i < 16; i++) {
      const da = centroid.grid[i * 3 + 1] - c.colourGrid[i * 3 + 1];
      const db = centroid.grid[i * 3 + 2] - c.colourGrid[i * 3 + 2];
      sum += da * da + db * db;
    }
    colLayout = Math.sqrt(sum);
  }
  // Dominant colour.
  const dc = toLab(c.oklch);
  const domDist = Math.hypot(centroid.lab[0] - dc[0], centroid.lab[1] - dc[1], centroid.lab[2] - dc[2]);

  return 0.65 * colLayout + 0.35 * domDist;
}

/**
 * Rank the archive against a *group* of references meant to share one edit.
 * See the module comment for why colour and composition are aggregated
 * differently — this is not "average everything."
 */
export function rankSimilarGroup(refs: Photo[], candidates: Photo[]): SimRow[] {
  const centroid = colourCentroid(refs);
  const raw = candidates.map((c) => ({
    photo: c,
    compRaw: Math.min(...refs.map((r) => compAgainst(r, c))),
    colRaw: colAgainst(centroid, c),
  }));

  const norm = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const d = hi - lo || 1;
    return (v: number) => (v - lo) / d;
  };
  const nc = norm(raw.map((r) => r.compRaw));
  const nk = norm(raw.map((r) => r.colRaw));
  return raw.map((r) => ({ photo: r.photo, comp: nc(r.compRaw), col: nk(r.colRaw) }));
}

/** The single-reference case — literally `rankSimilarGroup` with one reference. */
export function rankSimilar(ref: Photo, candidates: Photo[]): SimRow[] {
  return rankSimilarGroup([ref], candidates);
}

/** How far a group member's colours sit from what the *rest* of the group
 *  agrees on — the raw signal `groupOutliers` thresholds. Exported for the
 *  UI to show *how* far, not just a yes/no flag.
 *
 *  Each member is measured against the centroid of the *other* members, not
 *  one that includes itself. A real photo's own 4x4 grid already carries sky,
 *  shadow and midtone variation across its 16 cells, so a centroid that
 *  includes the very member being checked lets an actual outlier pull that
 *  centroid toward itself and partly hide from its own comparison — measured
 *  against real archive photos, not just clean synthetic ones, that was
 *  enough to mask a genuinely different photo at group sizes as small as
 *  three. Leaving it out of its own baseline is what catches it.
 *
 *  Only reports refs that carry a colour grid, and only once at least two of
 *  them do — with one, there is no "other members" to compare against. */
export function groupColourDistances(refs: Photo[]): Map<string, number> {
  const withGrid = refs.filter((r) => r.colourGrid && r.colourGrid.length === GRID_LENGTH);
  if (withGrid.length < 2) return new Map();
  return new Map(
    withGrid.map((r, i) => {
      const others = withGrid.filter((_, j) => j !== i);
      return [r.id, colAgainst(colourCentroid(others), r)];
    }),
  );
}

/** A distance more than this multiple of the group's *median* is flagged.
 *  Median, not mean, so one genuine outlier does not inflate the very
 *  baseline it is being measured against — the same reasoning as leaving it
 *  out of its own centroid above, applied to the threshold instead of the
 *  distance. Calibrated against real archive photos: two visually agreeing
 *  photos plus one genuinely different one landed around 1.5x on this
 *  measure, not the far larger ratio a clean synthetic example suggests. */
const OUTLIER_FACTOR = 1.45;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Which references, if any, look like they don't share the rest of the
 * group's edit — flagged so the UI can warn before a mismatched photo
 * quietly drags the colour centroid off target.
 *
 * Needs at least three references carrying a colour grid: with two, "which
 * one is the outlier" has no answer — either could be — and this refuses to
 * assert one rather than guess. (See the project's own rule on that.)
 */
export function groupOutliers(refs: Photo[]): Set<string> {
  const distances = groupColourDistances(refs);
  if (distances.size < 3) return new Set();

  const med = median([...distances.values()]);
  if (!(med > 0)) return new Set();

  const outliers = new Set<string>();
  for (const [id, dist] of distances) if (dist > med * OUTLIER_FACTOR) outliers.add(id);
  return outliers;
}
