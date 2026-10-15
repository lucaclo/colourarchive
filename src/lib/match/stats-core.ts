import {
  HSL_BANDS,
  bandOfHue,
  VIGNETTE_MIN_SYMMETRY,
  type HslBandStats,
  type PixelSample,
  type RegionKey,
  type RegionMasks,
  type RegionStats,
  type RgbImage,
  type VignetteStats,
} from './types';

// The measurement maths, with no I/O.
//
// Extracted from stats.ts so the SAME code runs on the server (fed by sharp)
// and in the browser (fed by a canvas). Two implementations of these formulas
// would be two chances to disagree, and a browser-measured photo that reported
// slightly different numbers than the same photo measured on the Mac would be
// impossible to debug and worse than having no fallback at all.
//
// Nothing here imports sharp, transformers, or anything Node-only.

const CHROMA_FLOOR = 0.02;
const MASK_IN = 128;
const HIST_BINS = 512;
const PERCENTILE_STEPS = 21;

// sRGB -> linear is a per-channel function of a byte, so it is exactly a
// 256-entry lookup.
const LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const x = i / 255;
  LINEAR_LUT[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

interface Acc {
  /** Total weight, not a pixel count — zones accumulate fractionally. */
  n: number;
  sumL: number;
  sumL2: number;
  sumC: number;
  sumC2: number;
  sumA: number;
  sumB: number;
  hist: Float64Array;
}

const newAcc = (): Acc => ({
  n: 0, sumL: 0, sumL2: 0, sumC: 0, sumC2: 0, sumA: 0, sumB: 0,
  hist: new Float64Array(HIST_BINS),
});

/**
 * Luminance-zone membership weights, summing to 1.
 *
 * These MUST match the weights the renderer (and Lightroom's Colour Grading)
 * applies, and they are deliberately soft. An earlier version accumulated zone
 * statistics in hard bands (L<0.35 / <0.7 / else) while the shader blended
 * across them — so the solver aimed each wheel at a target measured over a
 * different set of pixels than the wheel actually affects. Every zone tint was
 * therefore slightly wrong, in a way no amount of calibration could fix.
 */
export function zoneWeights(L: number): [number, number, number] {
  const s = Math.max(0, 1 - L / 0.5);
  const h = Math.max(0, (L - 0.5) / 0.5);
  const m = Math.max(0, 1 - Math.abs(L - 0.5) / 0.5);
  const t = s + m + h;
  return t > 0 ? [s / t, m / t, h / t] : [0, 1, 0];
}

function percentilesFrom(hist: Float64Array, total: number): number[] {
  const out: number[] = [];
  if (total <= 0) return new Array(PERCENTILE_STEPS).fill(0);
  let cum = 0;
  let bin = 0;
  for (let s = 0; s < PERCENTILE_STEPS; s++) {
    const target = (s / (PERCENTILE_STEPS - 1)) * total;
    while (bin < HIST_BINS - 1 && cum + hist[bin] < target) {
      cum += hist[bin];
      bin++;
    }
    out.push(bin / (HIST_BINS - 1));
  }
  return out;
}

function finish(key: RegionKey, acc: Acc, coverage: number): RegionStats | null {
  // `n` is total weight; a zone that no pixel falls into has ~0 weight.
  if (acc.n < 1e-6) return null;
  const meanL = acc.sumL / acc.n;
  const meanC = acc.sumC / acc.n;
  const meanA = acc.sumA / acc.n;
  const meanB = acc.sumB / acc.n;

  // Clamped at zero: with large n the two terms are close and floating point
  // can make the difference slightly negative, which NaNs through the sqrt.
  const varL = Math.max(0, acc.sumL2 / acc.n - meanL * meanL);
  const varC = Math.max(0, acc.sumC2 / acc.n - meanC * meanC);

  const resultant = Math.hypot(meanA, meanB);
  const strength = meanC > 1e-6 ? Math.min(1, resultant / meanC) : 0;
  let hueMean = (Math.atan2(meanB, meanA) * 180) / Math.PI;
  if (hueMean < 0) hueMean += 360;

  return {
    key,
    coverage,
    // Rounded because zones accumulate fractional weight, not whole pixels.
    sampled: Math.round(acc.n),
    L: { mean: meanL, sd: Math.sqrt(varL) },
    C: { mean: meanC, sd: Math.sqrt(varC) },
    hue: { mean: hueMean, strength },
    ab: { a: meanA, b: meanB },
    percentiles: percentilesFrom(acc.hist, acc.n),
  };
}

/** Precomputed HSL-band lookup, 1 degree resolution — Lightroom's own band
 *  edges (see HSL_BANDS). */
const BAND_OF_HUE = new Uint8Array(360);
for (let h = 0; h < 360; h++) BAND_OF_HUE[h] = bandOfHue(h + 0.5);

export interface MeasureResult {
  regions: Partial<Record<RegionKey, RegionStats>>;
  hslBands: HslBandStats[];
  sampledAt: number;
  width: number;
  height: number;
  /** A small, even sample of the pixels and their regions, for simulating a
   *  grade on this photo (see simulate.ts). */
  sample: PixelSample;
}

/**
 * The accumulation behind every measurement, one pixel at a time.
 *
 * Shared by the real photo (measureRegionsFromPixels) and the simulated one
 * (simulate.ts), so a predicted result is measured by exactly the code that
 * measured the reference. Two copies of this loop would be two chances to
 * disagree, and the disagreement would read as a grading error.
 */
export class Measurer {
  private readonly accs: Acc[];
  private readonly globalAcc = newAcc();
  private readonly zoneAccs = [newAcc(), newAcc(), newAcc()];
  private readonly bandAcc = HSL_BANDS.map(() => ({ n: 0, sumC: 0, sumL: 0, sumA: 0, sumB: 0 }));
  private chromaticN = 0;

  /** `maskKeys[k]` is the region whose membership is bit k of `add`'s bits. */
  constructor(readonly maskKeys: RegionKey[]) {
    this.accs = maskKeys.map(() => newAcc());
  }

  /** One pixel, linear sRGB, with its region bits. */
  add(r: number, g: number, b: number, bits: number): void {
    // Linear sRGB -> OKLab (Ottosson).
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

    const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
    const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
    const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
    const C = Math.sqrt(A * A + B * B);

    const bin = L <= 0 ? 0 : L >= 1 ? HIST_BINS - 1 : (L * (HIST_BINS - 1)) | 0;
    const push = (acc: Acc, w: number) => {
      acc.n += w;
      acc.sumL += w * L;
      acc.sumL2 += w * L * L;
      acc.sumC += w * C;
      acc.sumC2 += w * C * C;
      acc.sumA += w * A;
      acc.sumB += w * B;
      acc.hist[bin] += w;
    };

    push(this.globalAcc, 1);
    // Every pixel contributes to all three zones, weighted — see zoneWeights.
    const zw = zoneWeights(L);
    if (zw[0] > 0) push(this.zoneAccs[0], zw[0]);
    if (zw[1] > 0) push(this.zoneAccs[1], zw[1]);
    if (zw[2] > 0) push(this.zoneAccs[2], zw[2]);

    if (bits) for (let k = 0; k < this.accs.length; k++) if (bits & (1 << k)) push(this.accs[k], 1);

    if (C >= CHROMA_FLOOR) {
      let hue = (Math.atan2(B, A) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      const band = this.bandAcc[BAND_OF_HUE[hue | 0]];
      band.n++;
      band.sumC += C;
      band.sumL += L;
      band.sumA += A;
      band.sumB += B;
      this.chromaticN++;
    }
  }

  /** Finish into region and band statistics. `coverage` is each mask region's
   *  share of the frame before erosion, which the pixels alone can't tell. */
  result(coverage: Partial<Record<RegionKey, number>>): Pick<MeasureResult, 'regions' | 'hslBands'> {
    const regions: Partial<Record<RegionKey, RegionStats>> = {};
    const g = finish('global', this.globalAcc, 1);
    if (g) regions.global = g;
    const zoneKeys: RegionKey[] = ['zone.shadow', 'zone.midtone', 'zone.highlight'];
    this.zoneAccs.forEach((acc, i) => {
      const s = finish(zoneKeys[i], acc, acc.n / Math.max(1, this.globalAcc.n));
      if (s) regions[zoneKeys[i]] = s;
    });
    this.maskKeys.forEach((key, k) => {
      const s = finish(key, this.accs[k], coverage[key] ?? 0);
      if (s) regions[key] = s;
    });

    const hslBands: HslBandStats[] = HSL_BANDS.map((band, i) => {
      const a = this.bandAcc[i];
      if (a.n === 0) return { key: band.key, weight: 0, chroma: 0, L: 0, hue: band.H };
      const mA = a.sumA / a.n;
      const mB = a.sumB / a.n;
      let hue = (Math.atan2(mB, mA) * 180) / Math.PI;
      if (hue < 0) hue += 360;
      return {
        key: band.key,
        weight: this.chromaticN > 0 ? a.n / this.chromaticN : 0,
        chroma: a.sumC / a.n,
        L: a.sumL / a.n,
        hue,
      };
    });
    return { regions, hslBands };
  }
}

/** About this many pixels go into the sample: enough that every zone and any
 *  region bigger than a sliver holds hundreds, few enough that a full
 *  simulation of a grade takes a few milliseconds. */
const SAMPLE_TARGET = 16384;

/**
 * Measure every region present in `masks`, plus the global frame and the three
 * luminance zones (which need no segmentation and are therefore always
 * available — this is what the browser path relies on).
 */
export function measureRegionsFromPixels(img: RgbImage, masks: RegionMasks): MeasureResult {
  const { data, width: W, height: H, channels: ch } = img;

  const maskKeys = (Object.keys(masks.masks) as RegionKey[]).slice(0, 16);
  const maskArrays = maskKeys.map((k) => masks.masks[k]!);
  const measurer = new Measurer(maskKeys);

  // Masks live on their own grid; map between the two by integer index rather
  // than resizing, which would reintroduce the soft boundary pixels erosion
  // just removed.
  const hasMasks = maskArrays.length > 0;
  const mw = masks.width;
  const mh = masks.height;
  const colToMask = new Int32Array(hasMasks ? W : 0);
  if (hasMasks) for (let x = 0; x < W; x++) colToMask[x] = Math.min(mw - 1, Math.floor((x * mw) / W));
  const rowToMask = new Int32Array(hasMasks ? H : 0);
  if (hasMasks) for (let y = 0; y < H; y++) rowToMask[y] = Math.min(mh - 1, Math.floor((y * mh) / H));

  // The sample is an even grid, so it keeps the photo's composition.
  const step = Math.max(1, Math.sqrt((W * H) / SAMPLE_TARGET));
  const sw = Math.max(1, Math.floor(W / step));
  const sh = Math.max(1, Math.floor(H / step));
  const sRgb = new Uint8Array(sw * sh * 3);
  const sBits = new Uint16Array(sw * sh);
  const sampleCol = new Int32Array(W).fill(-1);
  for (let i = 0; i < sw; i++) sampleCol[Math.min(W - 1, Math.floor((i + 0.5) * step))] = i;
  const sampleRow = new Int32Array(H).fill(-1);
  for (let j = 0; j < sh; j++) sampleRow[Math.min(H - 1, Math.floor((j + 0.5) * step))] = j;

  for (let y = 0; y < H; y++) {
    const maskRow = hasMasks ? rowToMask[y] * mw : 0;
    const rowOff = y * W * ch;
    const sj = sampleRow[y];
    for (let x = 0; x < W; x++) {
      const p = rowOff + x * ch;
      let bits = 0;
      if (hasMasks) {
        const mi = maskRow + colToMask[x];
        for (let k = 0; k < maskArrays.length; k++) if (maskArrays[k][mi] >= MASK_IN) bits |= 1 << k;
      }
      measurer.add(LINEAR_LUT[data[p]], LINEAR_LUT[data[p + 1]], LINEAR_LUT[data[p + 2]], bits);
      if (sj >= 0) {
        const si = sampleCol[x];
        if (si >= 0) {
          const o = sj * sw + si;
          sRgb[o * 3] = data[p];
          sRgb[o * 3 + 1] = data[p + 1];
          sRgb[o * 3 + 2] = data[p + 2];
          sBits[o] = bits;
        }
      }
    }
  }

  const { regions, hslBands } = measurer.result(masks.coverage);
  return {
    regions,
    hslBands,
    sampledAt: Math.max(W, H),
    width: W,
    height: H,
    sample: encodeSample(sw, sh, sRgb, sBits, maskKeys, masks.coverage),
  };
}

// ─── Pixel sample ─────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (B) return new Uint8Array(B.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeSample(
  width: number,
  height: number,
  rgb: Uint8Array,
  bits: Uint16Array,
  regions: RegionKey[],
  coverage: Partial<Record<RegionKey, number>>,
): PixelSample {
  return {
    width,
    height,
    rgb: toBase64(rgb),
    bits: toBase64(new Uint8Array(bits.buffer, bits.byteOffset, bits.byteLength)),
    regions,
    coverage: Object.fromEntries(regions.map((k) => [k, coverage[k] ?? 0])),
  };
}

export interface DecodedSample {
  n: number;
  /** Linear sRGB, 3 per pixel. */
  linear: Float32Array;
  bits: Uint16Array;
  regions: RegionKey[];
  coverage: Partial<Record<RegionKey, number>>;
}

export function decodeSample(s: PixelSample): DecodedSample {
  const rgb = fromBase64(s.rgb);
  const raw = fromBase64(s.bits);
  const bits = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const n = Math.min(bits.length, Math.floor(rgb.length / 3));
  const linear = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) linear[i] = LINEAR_LUT[rgb[i]];
  return { n, linear, bits, regions: s.regions, coverage: s.coverage };
}

/** Measure a decoded sample exactly as a photo is measured. */
export function measureSample(s: DecodedSample, linear: Float32Array = s.linear): Pick<MeasureResult, 'regions' | 'hslBands'> {
  const m = new Measurer(s.regions);
  for (let i = 0; i < s.n; i++) m.add(linear[i * 3], linear[i * 3 + 1], linear[i * 3 + 2], s.bits[i]);
  return m.result(s.coverage);
}

/**
 * Corner falloff relative to centre, in stops.
 *
 * Computed in LINEAR light, because a stop is a ratio of light rather than of
 * perceptual lightness; deriving it from OKLCH L would badly understate deep
 * falloff. Expects a small (~192px) copy.
 */
export function measureVignetteFromPixels(img: RgbImage): VignetteStats {
  const { data, width: W, height: H, channels: ch } = img;
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const maxR = Math.hypot(cx, cy);

  let centreSum = 0;
  let centreN = 0;
  const cornerSums = [0, 0, 0, 0];
  const cornerNs = [0, 0, 0, 0];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * W + x) * ch;
      const Y =
        0.2126 * LINEAR_LUT[data[p]] + 0.7152 * LINEAR_LUT[data[p + 1]] + 0.0722 * LINEAR_LUT[data[p + 2]];
      const r = Math.hypot(x - cx, y - cy) / maxR;
      if (r < 0.3) {
        centreSum += Y;
        centreN++;
      } else if (r > 0.78) {
        const q = (y < cy ? 0 : 2) + (x < cx ? 0 : 1);
        cornerSums[q] += Y;
        cornerNs[q]++;
      }
    }
  }

  const centre = centreN > 0 ? centreSum / centreN : 0;
  const corners = cornerSums.map((s, i) => (cornerNs[i] > 0 ? s / cornerNs[i] : 0));
  const cornerMean = corners.reduce((a, b) => a + b, 0) / 4;

  const EPS = 1e-4;
  const falloffStops = Math.log2(Math.max(cornerMean, EPS) / Math.max(centre, EPS));

  // Coefficient of variation across quadrants, decayed smoothly. Real optical
  // falloff sits near 0.9; a bright sky in two corners lands near 0.3.
  const cv = (() => {
    if (cornerMean <= EPS) return Infinity;
    const varr = corners.reduce((a, c) => a + (c - cornerMean) ** 2, 0) / corners.length;
    return Math.sqrt(varr) / cornerMean;
  })();
  const symmetry = Number.isFinite(cv) ? Math.exp(-2 * cv) : 0;

  return { falloffStops, symmetry, usable: symmetry >= VIGNETTE_MIN_SYMMETRY };
}
