import { decodeSample, measureSample, type DecodedSample } from './stats-core';
import type { PhotoAnalysis, RegionKey } from './types';

// The reference, re-weighted to your photo's composition.
//
// A grade is a treatment — how sky is rendered, how foliage, how the rest —
// while a whole-frame histogram is that treatment MIXED WITH what happened to
// be in the frame. Matching a reference that is half sky against your street
// scene by whole-frame statistics brightens your street to make up for sky it
// doesn't have. The benchmark (scripts/match-bench.ts) shows it plainly: with
// the reference framed differently, every solver that matched whole-frame
// statistics ended further from the true grade than doing nothing at all.
//
// So the reference's pixel sample is re-weighted class by class until its mix
// of sky, water, foliage, buildings, ground and everything else matches yours.
// Each class keeps exactly the reference's treatment of it; only the
// proportions change. Classes the reference lacks can't be invented, so the
// classes it does have stand in for them in proportion.

/** The scene classes, in priority order where a pixel carries several. */
const CLASSES: RegionKey[] = ['scene.sky', 'scene.water', 'scene.foliage', 'scene.built', 'scene.ground'];
const REST = CLASSES.length;

/** No one reference pixel may stand for more than this many, so a sliver of
 *  a class that fills your frame can't dominate the target. */
const MAX_WEIGHT = 6;

/** Below this share of either sample, a class reweighting is noise. */
const MIN_SHARE = 0.01;

function classify(s: DecodedSample): { cls: Uint8Array; share: number[] } {
  const bitOf = CLASSES.map((k) => s.regions.indexOf(k));
  const cls = new Uint8Array(s.n);
  const count = new Array(REST + 1).fill(0);
  for (let i = 0; i < s.n; i++) {
    let c = REST;
    for (let k = 0; k < CLASSES.length; k++) {
      const b = bitOf[k];
      if (b >= 0 && s.bits[i] & (1 << b)) {
        c = k;
        break;
      }
    }
    cls[i] = c;
    count[c]++;
  }
  return { cls, share: count.map((c) => c / Math.max(1, s.n)) };
}

export interface Composed {
  /** The reference with its frame, zone and band statistics re-weighted to
   *  your composition. Region statistics are untouched — a region's numbers
   *  are already free of the frame's composition. */
  reference: PhotoAnalysis;
  /** How different the two compositions were: half the summed absolute share
   *  difference, 0 (same mix) to 1 (nothing in common). */
  mismatch: number;
  /** The biggest share differences, for the note: class, reference, yours. */
  differences: Array<{ region: RegionKey | 'rest'; reference: number; mine: number }>;
}

/**
 * The reference re-weighted to `mine`'s composition, or null when either photo
 * lacks a segmented pixel sample — then whole-frame statistics are all there
 * is, and the caller says so.
 */
export function composeReference(ref: PhotoAnalysis, mine: PhotoAnalysis): Composed | null {
  if (!ref.sample || !mine.sample) return null;
  const hasScene = (a: PhotoAnalysis) => CLASSES.some((k) => a.sample!.regions.includes(k));
  if (!hasScene(ref) && !hasScene(mine)) return null;

  const rs = decodeSample(ref.sample);
  const ms = decodeSample(mine.sample);
  const r = classify(rs);
  const m = classify(ms);
  const mismatch = r.share.reduce((s, x, i) => s + Math.abs(x - m.share[i]), 0) / 2;

  // Mass of classes yours has and the reference lacks goes to the classes it
  // has, in proportion — the only honest stand-in.
  const usable = r.share.map((x) => x >= MIN_SHARE);
  const covered = m.share.reduce((s, x, i) => s + (usable[i] ? x : 0), 0);
  if (covered < 0.2) return null;
  const perPixel = r.share.map((x, i) => (usable[i] ? Math.min(MAX_WEIGHT, m.share[i] / covered / x) : 0));
  const weights = new Float32Array(rs.n);
  for (let i = 0; i < rs.n; i++) weights[i] = perPixel[r.cls[i]];

  const measured = measureSample(rs, rs.linear, weights);
  const regions = { ...ref.regions };
  for (const k of ['global', 'zone.shadow', 'zone.midtone', 'zone.highlight'] as const) {
    if (measured.regions[k]) regions[k] = measured.regions[k];
  }
  const differences = r.share
    .map((x, i) => ({ region: (i === REST ? 'rest' : CLASSES[i]) as RegionKey | 'rest', reference: x, mine: m.share[i] }))
    .sort((a, b) => Math.abs(b.reference - b.mine) - Math.abs(a.reference - a.mine));
  return { reference: { ...ref, regions, hslBands: measured.hslBands }, mismatch, differences };
}
