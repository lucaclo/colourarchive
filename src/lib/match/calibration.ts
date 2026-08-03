// Calibration — measured units to Lightroom slider units.
//
// READ THIS BEFORE CHANGING ANY NUMBER HERE.
//
// Everything else in this feature is derived: OKLab conversions come from
// published matrices, percentile matching is exact, erosion is deterministic.
// This file is the exception. Lightroom's sliders are proprietary and
// non-linear, so the factor converting "0.031 of OKLab chroma" into "Saturation
// +18" cannot be derived from first principles — only measured.
//
// The constants below are considered estimates. They are chosen so that a
// mid-strength move lands in a sensible place, and they are deliberately
// gathered in one file so they can be REPLACED by real measurements rather than
// hunted through the solver.
//
// Two consequences worth being clear about:
//
//   1. The on-screen numbers and the WebGL preview always agree with each
//      other, because both are generated from the same forward model. What may
//      differ is Lightroom's own rendering of those same values.
//
//   2. That difference is systematic, not random — which means it is
//      measurable. `scripts/match-calibrate.ts` (see CALIBRATION.md) generates
//      probe presets; applying them in Lightroom, exporting, and feeding the
//      results back replaces these estimates with values true for the user's
//      own Lightroom version and colour profile.

export interface Calibration {
  /** Multiplier on `(chromaRatio - 1) * 100` to reach the Saturation slider. */
  saturationGain: number;
  /** Multiplier on the same quantity when routed through Vibrance instead.
   *  Vibrance acts mostly on low-chroma pixels, so a larger number is needed
   *  for the same measured change across the whole frame. */
  vibranceGain: number;
  /** OKLab a/b offset magnitude that corresponds to Color Grading saturation
   *  100 on a wheel. Smaller = the solver asks for bigger slider moves. */
  colorGradeUnit: number;
  /** OKLab b-axis offset corresponding to Temp +100 on the relative scale.
   *  (b is the blue/yellow axis, which is what Temp moves.) */
  tempUnit: number;
  /** OKLab a-axis offset corresponding to Tint +100. (a is green/magenta.) */
  tintUnit: number;
  /** Chroma ratio -> per-band Saturation slider gain in the Color Mixer. */
  hslSaturationGain: number;
  /** OKLCH lightness delta -> per-band Luminance slider gain. */
  hslLuminanceGain: number;
  /** Degrees of OKLCH hue rotation corresponding to a Color Mixer Hue slider
   *  value of 100 within a band. Bands are ~45 deg wide and the slider spans
   *  roughly half a band each way. */
  hslHueDegreesAt100: number;
  /** Measured grain RMS (at the normalised scale) corresponding to Grain
   *  Amount 100. */
  grainUnit: number;
  /** Measured acutance delta corresponding to Sharpening Amount 100. */
  sharpenUnit: number;
  /** Measured acutance delta corresponding to Texture 100. Texture works on a
   *  coarser frequency band than Sharpening, so it takes a larger measured
   *  change to justify the same slider value. */
  textureUnit: number;
  /** flat/edge ratio drop corresponding to Noise Reduction 100. */
  noiseReductionUnit: number;
  /** Stops of corner falloff corresponding to Vignette -100. */
  vignetteStopsAt100: number;
  /** Local (mask) exposure is in stops, same as global — no conversion needed,
   *  but local Temp/Tint use a different internal scale to the global ones. */
  localTempUnit: number;
  localTintUnit: number;
  /** Local saturation gain for mask adjustments. */
  localSaturationGain: number;
}

/** Estimated defaults. Replaceable by a measured calibration — see above. */
export const DEFAULT_CALIBRATION: Calibration = {
  saturationGain: 1.0,
  vibranceGain: 1.6,
  colorGradeUnit: 0.06,
  tempUnit: 0.055,
  tintUnit: 0.05,
  hslSaturationGain: 1.0,
  hslLuminanceGain: 320,
  hslHueDegreesAt100: 22,
  grainUnit: 0.055,
  sharpenUnit: 0.35,
  textureUnit: 0.5,
  noiseReductionUnit: 0.45,
  vignetteStopsAt100: 2.2,
  localTempUnit: 0.05,
  localTintUnit: 0.045,
  localSaturationGain: 1.0,
};

/** True when a calibration is still the shipped estimate rather than one
 *  measured against the user's own Lightroom. Drives an honest badge in the UI. */
export function isEstimated(cal: Calibration): boolean {
  return (Object.keys(DEFAULT_CALIBRATION) as Array<keyof Calibration>).every(
    (k) => cal[k] === DEFAULT_CALIBRATION[k],
  );
}
