// Black-and-white and toned references.
//
// Without this the solver met a monochrome reference the only way it knew —
// by pulling saturation down against a prior that prefers small moves, while
// the restrained answer deliberately protected colour the reference does not
// have. Matching a Fan Ho handed back a muted colour photograph.
//
// So a monochrome reference is recognised from its own measurements and the
// answer is constrained to match: Saturation -100, nothing in the Colour
// Mixer but its luminance (which in Lightroom is how a grey conversion is
// mixed), no Point Color, no colour in the masks. A *toned* reference — sepia,
// selenium, a split tone — keeps its Colour Grading wheels, because Lightroom
// grades after saturation and that is exactly where the tone is put back.
//
// Saturation -100 rather than the Black & White treatment: the treatment
// converts through Adobe's own auto mix, which the model does not simulate,
// and a preview that disagreed with Lightroom would be the worse failure.
//
// Thresholds are from the board itself: the two Fan Ho prints measure chroma
// 0.005 (neutral) and 0.03 with hue agreement 0.99 (sepia), a warm grey wall
// 0.013 with agreement 0.72; every colour reference on the board has a
// chroma spread above 0.02 or hues that disagree.

import type { Adjustments } from './adjustments';
import type { PhotoAnalysis } from './types';

export type Monochrome = 'mono' | 'toned';

/** OKLCH chroma under which a frame is grey, mean and spread. */
const MONO_MEAN = 0.01;
const MONO_SD = 0.008;
/**
 * A toned print: little colour, all of it the same way. Conservative on
 * purpose, because a low-colour *scene* — fog, sand, a warm interior — with a
 * tint in its grade measures much the same, and taking its colour away would
 * be a confident wrong answer (it cost the benchmark's synthetic cases). So
 * either the hue agreement is near perfect, or the colour is barely there.
 */
const TONED_MEAN = 0.03;
const TONED_SD = 0.014;
const TONED_AGREEMENT = 0.95;
const TONED_FAINT_MEAN = 0.016;
const TONED_FAINT_AGREEMENT = 0.65;

/**
 * Whether a reference is black and white, toned, or neither.
 *
 * Read from the whole-frame region: mean chroma and its spread, and how much
 * the pixels agree on a hue — the length of the mean a/b against the mean
 * chroma, 1 when every pixel leans the same way.
 */
export function monochromeOf(a: PhotoAnalysis): Monochrome | null {
  const g = a.regions.global;
  if (!g || !(g.sampled > 0)) return null;
  const mean = g.C.mean;
  const sd = g.C.sd;
  if (mean < MONO_MEAN && sd < MONO_SD) return 'mono';
  const agreement = Math.hypot(g.ab.a, g.ab.b) / Math.max(1e-6, mean);
  if (mean < TONED_MEAN && sd < TONED_SD) {
    if (agreement > TONED_AGREEMENT) return 'toned';
    if (mean < TONED_FAINT_MEAN && agreement > TONED_FAINT_AGREEMENT) return 'toned';
  }
  return null;
}

/** An answer held to the reference's monochrome. */
export function asMonochrome(adj: Adjustments, kind: Monochrome): Adjustments {
  const hsl = Object.fromEntries(
    Object.entries(adj.hsl).map(([k, v]) => [k, { hue: 0, sat: 0, lum: v.lum }]),
  ) as Adjustments['hsl'];
  const grading =
    kind === 'mono'
      ? {
          ...adj.grading,
          global: { ...adj.grading.global, hue: 0, sat: 0 },
          shadows: { ...adj.grading.shadows, hue: 0, sat: 0 },
          midtones: { ...adj.grading.midtones, hue: 0, sat: 0 },
          highlights: { ...adj.grading.highlights, hue: 0, sat: 0 },
        }
      : adj.grading;
  return {
    ...adj,
    saturation: -100,
    vibrance: 0,
    // White balance only tints what saturation leaves: in a grey print that
    // is nothing, in a toned one the wheels carry the tone instead.
    temp: kind === 'mono' ? 0 : adj.temp,
    tint: kind === 'mono' ? 0 : adj.tint,
    hsl,
    grading,
    pointColors: [],
    masks: adj.masks.map((m) => ({ ...m, temp: 0, tint: 0, saturation: 0 })),
  };
}
