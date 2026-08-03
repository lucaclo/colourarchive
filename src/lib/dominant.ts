import sharp from 'sharp';
import { srgb255ToOklch, type OKLCH } from './color';

// Dominant colour — the colour a person would *name* the photo by, not the most
// frequent pixel (usually a muddy background) nor the average (mud). We weight
// each pixel by its colourfulness and by being well-lit, then find the strongest
// hue *cluster* and return its centroid. So:
//   • large desaturated areas (beige, haze, foliage) don't outvote the subject,
//   • a small vivid patch (the classic red sign in a dark frame) can define it,
//   • red + blue never average into a false purple (mode, not global mean).

const SAMPLE_EDGE = 128;      // analysis thumbnail long edge
const NB = 36;                // hue histogram bins (10° each)
const BINW = 360 / NB;
const HALF = 2;               // cluster window: ±2 bins ≈ ±25°
const CHROMA_FLOOR = 0.02;    // below this a pixel is treated as grey (no vote)
const ACHROMATIC_OUT = 0.035; // if even the strongest cluster is greyer than this → achromatic
// If the average colourfulness across *well-lit* pixels is below this, the photo
// is essentially monochrome and any colour is incidental (e.g. a thin red book
// spine on a black-and-white frame) → achromatic. This is what separates it from
// a genuine "vivid sign in a DARK frame" (there the lit area IS the colour).
const MONO_FRACTION = 0.007;

// Smoothstep.
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Lightness window: discount deep shadow and blown highlight, full weight in the
// midtones where colour actually lives.
const litWeight = (L: number): number =>
  Math.max(0, Math.min(smooth(0.06, 0.26, L), 1 - smooth(0.85, 0.97, L)));

export async function dominantColour(input: Buffer | string): Promise<OKLCH> {
  const { data, info } = await sharp(input)
    .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ch = info.channels; // 3 after removeAlpha
  const W = new Float64Array(NB); // colourfulness mass per hue bin
  const SL = new Float64Array(NB);
  const SA = new Float64Array(NB);
  const SB = new Float64Array(NB);

  let litSum = 0, litLSum = 0, anyW = 0, chromaMass = 0;

  for (let i = 0; i < data.length; i += ch) {
    const o = srgb255ToOklch(data[i], data[i + 1], data[i + 2]);
    const lw = litWeight(o.L);
    if (lw > 0) { litSum += lw; litLSum += lw * o.L; }

    // Vote weight: well-lit AND colourful, with chroma emphasised superlinearly
    // (~chroma²) so a small vivid subject outweighs a large muddy/desaturated
    // field instead of losing to it on pixel count alone.
    const cAbove = Math.max(0, o.C - CHROMA_FLOOR);
    chromaMass += lw * cAbove; // linear colour presence, for the monochrome test
    const w = lw * o.C * cAbove;
    if (w > 0) {
      const rad = (o.H * Math.PI) / 180;
      const bi = Math.floor(o.H / BINW) % NB;
      W[bi] += w;
      SL[bi] += w * o.L;
      SA[bi] += w * o.C * Math.cos(rad);
      SB[bi] += w * o.C * Math.sin(rad);
      anyW += w;
    }
  }

  // No colour, or colour only incidental against a well-lit monochrome frame →
  // achromatic (mean lit lightness for a sensible grey).
  if (anyW <= 0 || (litSum > 0 && chromaMass / litSum < MONO_FRACTION)) {
    return { L: litSum > 0 ? litLSum / litSum : 0.5, C: 0, H: 0 };
  }

  // Strongest hue cluster: circular windowed arg-max over the mass histogram.
  let best = 0, bestScore = -1;
  for (let i = 0; i < NB; i++) {
    let s = 0;
    for (let k = -HALF; k <= HALF; k++) s += W[(i + k + NB) % NB];
    if (s > bestScore) { bestScore = s; best = i; }
  }

  // Centroid of that cluster.
  let sw = 0, sL = 0, sA = 0, sB = 0;
  for (let k = -HALF; k <= HALF; k++) {
    const j = (best + k + NB) % NB;
    sw += W[j]; sL += SL[j]; sA += SA[j]; sB += SB[j];
  }
  const L = sL / sw, a = sA / sw, b = sB / sw;
  const C = Math.sqrt(a * a + b * b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  // Even the strongest cluster is barely coloured → the photo reads as grey.
  if (C < ACHROMATIC_OUT) {
    return { L: litSum > 0 ? litLSum / litSum : L, C: 0, H: 0 };
  }
  return { L, C, H };
}
