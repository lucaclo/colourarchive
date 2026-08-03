import type { TextureBlock, TextureStats } from './types';

// Grain, noise and sharpening — the maths, with crop extraction abstracted
// behind a sampler so the same code serves sharp on the server and a canvas in
// the browser.
//
// These live entirely in the highest spatial frequencies, so they cannot be
// measured on a resized image. Everything here works on native-resolution
// crops, and refuses outright when the source cannot support the measurement.

/** Crop size in native pixels. Multiple of 8 so crops align to the JPEG DCT
 *  grid — without that alignment the blockiness test measures nothing. */
export const CROP = 192;
const GRID_X = 4;
const GRID_Y = 3;

const MIN_LONG_EDGE = 900;
const MIN_SHORT_EDGE = 500;
const BLOCKINESS_LIMIT = 1.28;
const UPSCALE_FLOOR = 0.0016;

/** Long edge that texture numbers are reported at. Grain and acutance are
 *  per-pixel quantities and therefore not comparable across sizes: measuring a
 *  2500px reference against a 4500px photo natively made the reference look 6x
 *  grainier and 2x sharper purely as an artefact of size. */
export const TEXTURE_NORM_EDGE = 2400;

export const TEXTURE_SCALE_TOLERANCE = 0.15;

/** Can these two texture measurements honestly be differenced? */
export function textureComparable(a: TextureStats, b: TextureStats): boolean {
  if (!a.usable || !b.usable) return false;
  const la = Math.max(a.measuredAt.width, a.measuredAt.height);
  const lb = Math.max(b.measuredAt.width, b.measuredAt.height);
  return Math.abs(la - lb) / Math.max(la, lb) <= TEXTURE_SCALE_TOLERANCE;
}

/** Rec.709 luminance on gamma-encoded bytes. Noise and acutance are
 *  conventionally quoted in display units, so no linearisation here —
 *  deliberate, and different from the vignette measurement. */
export function toLuma(data: Uint8Array | Uint8ClampedArray, n: number, ch: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ch;
    out[i] = 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  }
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += src[row + Math.min(w - 1, Math.max(0, x + k))];
      tmp[row + x] = s / win;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s / win;
    }
  }
  return out;
}

export interface CropMeasurement {
  grainRms: number;
  edgeRms: number;
  acutance: number;
  blockiness: number;
  scaleRatio: number;
}

export function measureCrop(luma: Float32Array, w: number, h: number): CropMeasurement | null {
  const blur1 = boxBlur(luma, w, h, 1);
  const blur2 = boxBlur(luma, w, h, 2);

  // Sobel on the blurred copy: structure, deliberately not noise.
  const grad = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -blur1[i - w - 1] - 2 * blur1[i - 1] - blur1[i + w - 1] +
        blur1[i - w + 1] + 2 * blur1[i + 1] + blur1[i + w + 1];
      const gy =
        -blur1[i - w - 1] - 2 * blur1[i - w] - blur1[i - w + 1] +
        blur1[i + w - 1] + 2 * blur1[i + w] + blur1[i + w + 1];
      grad[i] = Math.hypot(gx, gy);
    }
  }

  // Flat vs edge by gradient percentile — thresholds must adapt per crop, since
  // "flat" in a busy frame is not flat in a plain sky.
  const hist = new Uint32Array(256);
  let counted = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      hist[Math.min(255, grad[y * w + x] | 0)]++;
      counted++;
    }
  }
  if (counted === 0) return null;

  const pct = (p: number): number => {
    const target = p * counted;
    let cum = 0;
    for (let b = 0; b < 256; b++) {
      cum += hist[b];
      if (cum >= target) return b;
    }
    return 255;
  };
  const flatMax = pct(0.35);
  const edgeMin = pct(0.85);

  let flatSum = 0, flatN = 0, flatSum2 = 0, flatN2 = 0;
  let edgeSum = 0, edgeN = 0, acuSum = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const g = grad[i];
      const r1 = luma[i] - blur1[i];
      const r2 = luma[i] - blur2[i];
      if (g <= flatMax) {
        flatSum += r1 * r1; flatN++;
        flatSum2 += r2 * r2; flatN2++;
      } else if (g >= edgeMin) {
        edgeSum += r1 * r1; edgeN++;
        acuSum += g;
      }
    }
  }
  if (flatN === 0 || edgeN === 0) return null;

  const grainRms = Math.sqrt(flatSum / flatN) / 255;
  const coarseRms = Math.sqrt(flatSum2 / flatN2) / 255;
  const edgeRms = Math.sqrt(edgeSum / edgeN) / 255;

  // Blockiness: gradient across an 8px boundary vs within a block.
  let onSum = 0, onN = 0, offSum = 0, offN = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const d = Math.abs(luma[row + x] - luma[row + x - 1]);
      if (x % 8 === 0) { onSum += d; onN++; } else { offSum += d; offN++; }
    }
  }
  // In a near-featureless crop the within-block denominator approaches zero and
  // this ratio explodes, reporting heavy compression for a clean file. A flat
  // crop is no evidence either way, so report neutral and let others decide.
  const withinBlock = offN > 0 ? offSum / offN : 0;
  const BLOCKINESS_ACTIVITY_FLOOR = 0.45;
  const blockiness =
    withinBlock < BLOCKINESS_ACTIVITY_FLOOR ? 1 : (onSum / Math.max(1, onN)) / withinBlock;

  const scaleRatio = coarseRms > 1e-9 ? grainRms / coarseRms : 1;
  return { grainRms, edgeRms, acutance: acuSum / edgeN / 255, blockiness, scaleRatio };
}

export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Full 4x3 grid, and a five-point spread for the cheap native probe. The
 *  spread matters: taking the first N of the full grid samples only the TOP
 *  ROW, which in most photographs is sky — smooth, low activity, and exactly
 *  where the blockiness ratio is least reliable. */
export const FULL_GRID: Array<[number, number]> = Array.from({ length: GRID_Y }, (_, gy) =>
  Array.from({ length: GRID_X }, (_, gx) => [gx, gy] as [number, number]),
).flat();
export const SPREAD_GRID: Array<[number, number]> = [
  [0, 0], [GRID_X - 1, 0], [0, GRID_Y - 1], [GRID_X - 1, GRID_Y - 1],
  [(GRID_X - 1) >> 1, (GRID_Y - 1) >> 1],
];

/** Where a grid position lands, in pixels, for an image of this size. */
export function cropOrigin(
  width: number,
  height: number,
  gx: number,
  gy: number,
): { left: number; top: number } | null {
  // Inset from the frame edge: corners carry lens softness and vignetting that
  // would read as lower acutance.
  const insetX = Math.floor(width * 0.08);
  const insetY = Math.floor(height * 0.08);
  const spanX = width - insetX * 2 - CROP;
  const spanY = height - insetY * 2 - CROP;
  if (spanX <= 0 || spanY <= 0) return null;
  // 8-align so the blockiness test lines up with the DCT grid.
  return {
    left: (insetX + Math.round((spanX * gx) / Math.max(1, GRID_X - 1))) & ~7,
    top: (insetY + Math.round((spanY * gy) / Math.max(1, GRID_Y - 1))) & ~7,
  };
}

export const blockedTexture = (
  blockedBy: TextureBlock,
  reason: string,
  native: { width: number; height: number },
): TextureStats => ({
  usable: false,
  blocked: blockedBy,
  reason,
  normalised: false,
  nativeSize: native,
  grain: 0,
  grainSize: 0,
  acutance: 0,
  flatToEdge: 0,
  measuredAt: native,
});

/** Supplies one crop's luminance. Returns null if the crop cannot be taken. */
export type CropSampler = (
  left: number,
  top: number,
) => Promise<{ luma: Float32Array; width: number; height: number } | null>;

export interface TextureSource {
  nativeWidth: number;
  nativeHeight: number;
  /** Crops at native resolution — the only place JPEG blocking exists. */
  sampleNative: CropSampler;
  /** Crops at the common comparison scale. Null when the image is already at
   *  or below TEXTURE_NORM_EDGE, in which case native is used for both. */
  normalised: { width: number; height: number; sample: CropSampler } | null;
}

async function runGrid(
  sample: CropSampler,
  width: number,
  height: number,
  positions: Array<[number, number]>,
): Promise<CropMeasurement[]> {
  const out: CropMeasurement[] = [];
  for (const [gx, gy] of positions) {
    const origin = cropOrigin(width, height, gx, gy);
    if (!origin) continue;
    const crop = await sample(origin.left, origin.top);
    if (!crop) continue;
    const m = measureCrop(crop.luma, crop.width, crop.height);
    if (m) out.push(m);
  }
  return out;
}

/** Run the full measurement over a source. Honesty gates included. */
export async function measureTextureFrom(src: TextureSource): Promise<TextureStats> {
  const native = { width: src.nativeWidth, height: src.nativeHeight };

  if (
    Math.max(native.width, native.height) < MIN_LONG_EDGE ||
    Math.min(native.width, native.height) < MIN_SHORT_EDGE
  ) {
    return blockedTexture(
      'resolution',
      `Too small to read grain honestly (${native.width}x${native.height}). Grain, noise and sharpening need roughly ${MIN_LONG_EDGE}px on the long edge — below that, what looks like grain is mostly resizing.`,
      native,
    );
  }

  // Compression gate, on NATIVE pixels: the 8x8 DCT grid exists only there.
  const probe = await runGrid(src.sampleNative, native.width, native.height, SPREAD_GRID);
  if (probe.length < 3) {
    return blockedTexture('resolution', 'Not enough usable native-resolution samples to measure texture.', native);
  }
  const blockiness = median(probe.map((r) => r.blockiness));
  if (blockiness > BLOCKINESS_LIMIT) {
    return blockedTexture(
      'compression',
      `JPEG compression artefacts dominate the fine detail here (blockiness ${blockiness.toFixed(2)}x). Any grain reading would mostly be measuring the compressor, not the photograph.`,
      native,
    );
  }

  const target = src.normalised;
  const results = target
    ? await runGrid(target.sample, target.width, target.height, FULL_GRID)
    : await runGrid(src.sampleNative, native.width, native.height, FULL_GRID);
  if (results.length < 4) {
    return blockedTexture('resolution', 'Not enough usable samples to measure texture.', native);
  }

  const grain = median(results.map((r) => r.grainRms));
  const edgeRms = median(results.map((r) => r.edgeRms));
  const acutance = median(results.map((r) => r.acutance));
  const scaleRatio = median(results.map((r) => r.scaleRatio));

  if (grain < UPSCALE_FLOOR && acutance < 0.02) {
    return blockedTexture(
      'upscaled',
      'There is almost no genuine high-frequency detail in this image, which means it was enlarged from something smaller. Grain and sharpening cannot be read from it.',
      native,
    );
  }

  // Two-scale energy ratio as a coarseness proxy: fine 1px noise is removed by
  // both blurs so the ratio sits near 1; coarse grain partly survives the 3x3
  // blur and pulls it down. An index, not a micrometre measurement.
  const grainSize = Math.max(1, Math.min(6, 1 + (1 - Math.min(1, scaleRatio)) * 8));

  return {
    usable: true,
    blocked: 'none',
    normalised: Boolean(target),
    nativeSize: native,
    grain,
    grainSize,
    acutance,
    flatToEdge: edgeRms > 1e-9 ? grain / edgeRms : 0,
    measuredAt: target ? { width: target.width, height: target.height } : native,
  };
}
