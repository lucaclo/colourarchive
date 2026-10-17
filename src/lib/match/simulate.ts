import type { Adjustments } from './adjustments';
import type { Calibration } from './calibration';
import { prepareLr, renderLinear, srgbEncode, type LrTables } from './lr-model';
import { measureSample, type DecodedSample } from './stats-core';
import type { HslBandStats, PhotoAnalysis, RegionKey, RegionStats } from './types';

// Put a grade on the photo's pixel sample through the Lightroom model, and
// measure the result exactly as the reference was measured.
//
// This is what lets the solver check itself. Before round 6 it predicted the
// outcome from region AVERAGES pushed through each control in turn — but the
// average of a curve is not the curve of the average, an S-curve adds colour
// that a lightness-only prediction never sees, and Lightroom's mixer and
// grading are not the linear gains the prediction assumed. Rendering the
// pixels answers "what will Lightroom actually show" directly.

const ZONES: RegionKey[] = ['zone.shadow', 'zone.midtone', 'zone.highlight'];

/** Where a grade is meant to land — the reference itself for the faithful
 *  solution, the solver's own intent for the restrained one. Plain data, so it
 *  can travel with a solution. */
export interface SimTarget {
  /** Global OKLab L percentiles, 21 steps. */
  percentiles: number[];
  zones: Partial<Record<RegionKey, { L: number; a: number; b: number; C: number; coverage: number }>>;
  bands: HslBandStats[];
  regions: Partial<Record<RegionKey, { L: number; a: number; b: number; C: number }>>;
}

export interface Measured {
  regions: Partial<Record<RegionKey, RegionStats>>;
  hslBands: HslBandStats[];
}

export function targetFromAnalysis(a: PhotoAnalysis): SimTarget {
  const zones: SimTarget['zones'] = {};
  const regions: SimTarget['regions'] = {};
  for (const [key, r] of Object.entries(a.regions) as Array<[RegionKey, RegionStats]>) {
    const v = { L: r.L.mean, a: r.ab.a, b: r.ab.b, C: r.C.mean };
    if (ZONES.includes(key)) zones[key] = { ...v, coverage: r.coverage };
    else if (key !== 'global') regions[key] = v;
  }
  return { percentiles: [...(a.regions.global?.percentiles ?? [])], zones, bands: a.hslBands.map((b) => ({ ...b })), regions };
}

/** Render `adj` over the sample (every `stride`th pixel) and measure it. */
export function simulate(
  adj: Adjustments,
  sample: DecodedSample,
  tables: LrTables,
  cal?: Calibration,
  stride = 1,
): Measured {
  // Only what the preset carries: a mask you have to draw yourself is advice,
  // not part of the .xmp, so it isn't part of the prediction either.
  const carried = { ...adj, masks: adj.masks.filter((m) => m.kind !== 'manual') };
  const prep = prepareLr(carried, tables, sample.regions, cal);
  const n = Math.ceil(sample.n / stride);
  const out = new Float32Array(n * 3);
  const bits = new Uint16Array(n);
  const weights = new Float32Array(sample.regions.length);
  const px = new Float64Array(3);
  const hasMasks = prep.masks.some((m) => m.gain !== 1 || m.a !== 0 || m.b !== 0 || m.chroma !== 1);
  for (let j = 0, i = 0; i < sample.n; i += stride, j++) {
    const b = sample.bits[i];
    if (hasMasks) for (let k = 0; k < weights.length; k++) weights[k] = b & (1 << k) ? 1 : 0;
    renderLinear(prep, sample.linear[i * 3], sample.linear[i * 3 + 1], sample.linear[i * 3 + 2], hasMasks ? weights : null, px);
    out[j * 3] = px[0];
    out[j * 3 + 1] = px[1];
    out[j * 3 + 2] = px[2];
    bits[j] = b;
  }
  return measureSample({ ...sample, n, bits, linear: out }, out);
}

// ─── How close is it ──────────────────────────────────────────────────────

/** OKLab L (0..1) to the 0..255 encoded scale Lightroom's curve and histogram use. */
export const encodedLevel = (L: number): number => srgbEncode(Math.max(0, Math.min(1, L)) ** 3) * 255;

export interface Closeness {
  /** Mean ΔE (OKLab × 100) across the three tonal zones — about 1 is the
   *  smallest difference anyone sees side by side, 5 is obvious. */
  deltaE: number;
  /** Mean tone gap along the histogram, in 0..255 levels (5%–95%). */
  toneLevels: number;
  /** ΔE per segmented region both photos have. */
  regions: Partial<Record<RegionKey, number>>;
  /** One figure for "how far apart", in ΔE units: the zone colour gap and the
   *  tone gap along the histogram together (255 levels ≈ 100 of lightness).
   *  Zone ΔE alone can't see two photos with the same average tones and
   *  different contrast; this can. */
  distance: number;
}

export function closeness(sim: Measured, target: SimTarget): Closeness {
  let sum = 0;
  let n = 0;
  for (const z of ZONES) {
    const t = target.zones[z];
    const s = sim.regions[z];
    if (!t || !s) continue;
    sum += 100 * Math.hypot(t.L - s.L.mean, t.a - s.ab.a, t.b - s.ab.b);
    n++;
  }
  const sp = sim.regions.global?.percentiles ?? [];
  let tone = 0;
  let tn = 0;
  for (let i = 1; i < 20 && i < sp.length && i < target.percentiles.length; i++) {
    tone += Math.abs(encodedLevel(target.percentiles[i]) - encodedLevel(sp[i]));
    tn++;
  }
  const regions: Closeness['regions'] = {};
  for (const [key, t] of Object.entries(target.regions) as Array<[RegionKey, NonNullable<SimTarget['regions'][RegionKey]>]>) {
    const s = sim.regions[key];
    if (s) regions[key] = 100 * Math.hypot(t.L - s.L.mean, t.a - s.ab.a, t.b - s.ab.b);
  }
  const deltaE = n ? sum / n : 0;
  const toneLevels = tn ? tone / tn : 0;
  return { deltaE, toneLevels, regions, distance: Math.hypot(deltaE, toneLevels * (100 / 255)) };
}
