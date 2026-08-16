import type { HslBand, RegionKey } from './types';

// The Lightroom control surface, as data.
//
// Scoped to what Lightroom (cloud) — desktop and iPad — actually exposes, since
// that is where these values get used. Ranges match the app's own, and every
// value is clamped to them before it leaves the solver: an out-of-range number
// in a preset is silently ignored on import, which would look like the feature
// simply not working.

export interface CurvePoint {
  /** Input, 0..255 in Lightroom's curve space. */
  x: number;
  /** Output, 0..255. */
  y: number;
}

export interface HslTriple {
  hue: number; // -100..100
  sat: number; // -100..100
  lum: number; // -100..100
}

export interface GradeWheel {
  /** 0..360, in Lightroom's colour convention (0 red, 120 green, 240 blue) —
   *  NOT OKLCH hue. Converted in solve.ts. */
  hue: number;
  sat: number; // 0..100
  lum: number; // -100..100
}

export interface MaskAdjustment {
  /** Which measured region this came from. */
  region: RegionKey;
  /** The Lightroom mask that reproduces it. `subject` and `sky` regenerate
   *  themselves on import; `manual` means the user must draw it. */
  kind: 'subject' | 'sky' | 'background' | 'manual';
  /** Shown in the UI and written as the mask's name in the preset. */
  label: string;
  exposure: number; // stops, -4..4
  temp: number; // -100..100
  tint: number; // -100..100
  saturation: number; // -100..100
  contrast: number; // -100..100
  /** Why this mask exists, in one line, for the evidence panel. */
  rationale: string;
}

export interface Adjustments {
  // --- Light ---
  exposure: number; // stops, -5..5
  contrast: number; // -100..100 (descriptive; the curve carries the real move)
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  /** Point curve. Shared x positions across solutions so they can be blended. */
  curve: CurvePoint[];

  // --- Colour ---
  /** Relative white balance, -100..100. Reported for manual use; the preset
   *  routes the same move through Color Grading so it stays relative on RAW. */
  temp: number;
  tint: number;
  vibrance: number; // -100..100
  saturation: number; // -100..100

  // --- Colour Mixer (HSL) ---
  hsl: Record<HslBand['key'], HslTriple>;

  // --- Colour Grading ---
  grading: {
    global: GradeWheel;
    shadows: GradeWheel;
    midtones: GradeWheel;
    highlights: GradeWheel;
    blending: number; // 0..100
    balance: number; // -100..100
  };

  // --- Effects ---
  texture: number; // -100..100
  clarity: number; // -100..100
  dehaze: number; // -100..100
  vignette: number; // -100..100
  grainAmount: number; // 0..100
  grainSize: number; // 0..100
  grainRoughness: number; // 0..100

  // --- Detail ---
  sharpenAmount: number; // 0..150
  sharpenRadius: number; // 0.5..3
  sharpenDetail: number; // 0..100
  noiseReduction: number; // 0..100
  colorNoiseReduction: number; // 0..100

  // --- Masks ---
  masks: MaskAdjustment[];
}

const HSL_KEYS: HslBand['key'][] = [
  'red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta',
];

export const zeroHsl = (): Record<HslBand['key'], HslTriple> =>
  Object.fromEntries(HSL_KEYS.map((k) => [k, { hue: 0, sat: 0, lum: 0 }])) as Record<
    HslBand['key'],
    HslTriple
  >;

const zeroWheel = (): GradeWheel => ({ hue: 0, sat: 0, lum: 0 });

/** An Adjustments that changes nothing. Also the t=0 end of the strength slider. */
export function identityAdjustments(curveX: number[] = [0, 255]): Adjustments {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    curve: curveX.map((x) => ({ x, y: x })),
    temp: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    hsl: zeroHsl(),
    grading: {
      global: zeroWheel(),
      shadows: zeroWheel(),
      midtones: zeroWheel(),
      highlights: zeroWheel(),
      blending: 50,
      balance: 0,
    },
    texture: 0,
    clarity: 0,
    dehaze: 0,
    vignette: 0,
    grainAmount: 0,
    grainSize: 25,
    grainRoughness: 50,
    sharpenAmount: 0,
    sharpenRadius: 1,
    sharpenDetail: 25,
    noiseReduction: 0,
    colorNoiseReduction: 0,
    masks: [],
  };
}

export const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0;

/** Clamp every field to Lightroom's real range. Out-of-range values in an .xmp
 *  are dropped silently on import, so this is not cosmetic. */
export function clampAdjustments(a: Adjustments): Adjustments {
  const w = (g: GradeWheel): GradeWheel => ({
    hue: ((g.hue % 360) + 360) % 360,
    sat: clamp(g.sat, 0, 100),
    lum: clamp(g.lum, -100, 100),
  });
  return {
    ...a,
    exposure: clamp(a.exposure, -5, 5),
    contrast: clamp(a.contrast, -100, 100),
    highlights: clamp(a.highlights, -100, 100),
    shadows: clamp(a.shadows, -100, 100),
    whites: clamp(a.whites, -100, 100),
    blacks: clamp(a.blacks, -100, 100),
    curve: a.curve.map((p) => ({ x: clamp(Math.round(p.x), 0, 255), y: clamp(Math.round(p.y), 0, 255) })),
    temp: clamp(a.temp, -100, 100),
    tint: clamp(a.tint, -100, 100),
    vibrance: clamp(a.vibrance, -100, 100),
    saturation: clamp(a.saturation, -100, 100),
    hsl: Object.fromEntries(
      HSL_KEYS.map((k) => [
        k,
        {
          hue: clamp(a.hsl[k].hue, -100, 100),
          sat: clamp(a.hsl[k].sat, -100, 100),
          lum: clamp(a.hsl[k].lum, -100, 100),
        },
      ]),
    ) as Record<HslBand['key'], HslTriple>,
    grading: {
      global: w(a.grading.global),
      shadows: w(a.grading.shadows),
      midtones: w(a.grading.midtones),
      highlights: w(a.grading.highlights),
      blending: clamp(a.grading.blending, 0, 100),
      balance: clamp(a.grading.balance, -100, 100),
    },
    texture: clamp(a.texture, -100, 100),
    clarity: clamp(a.clarity, -100, 100),
    dehaze: clamp(a.dehaze, -100, 100),
    vignette: clamp(a.vignette, -100, 100),
    grainAmount: clamp(a.grainAmount, 0, 100),
    grainSize: clamp(a.grainSize, 0, 100),
    grainRoughness: clamp(a.grainRoughness, 0, 100),
    sharpenAmount: clamp(a.sharpenAmount, 0, 150),
    sharpenRadius: clamp(a.sharpenRadius, 0.5, 3),
    sharpenDetail: clamp(a.sharpenDetail, 0, 100),
    noiseReduction: clamp(a.noiseReduction, 0, 100),
    colorNoiseReduction: clamp(a.colorNoiseReduction, 0, 100),
    masks: a.masks.map((m) => ({
      ...m,
      exposure: clamp(m.exposure, -4, 4),
      temp: clamp(m.temp, -100, 100),
      tint: clamp(m.tint, -100, 100),
      saturation: clamp(m.saturation, -100, 100),
      contrast: clamp(m.contrast, -100, 100),
    })),
  };
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Shortest-path interpolation on a hue circle — 350 to 10 goes through 0, not
 *  the long way round through 180. */
function lerpHue(a: number, b: number, t: number): number {
  const d = ((b - a) % 360 + 540) % 360 - 180;
  return ((a + d * t) % 360 + 360) % 360;
}

function lerpWheel(a: GradeWheel, b: GradeWheel, t: number): GradeWheel {
  // When one side has no saturation its hue is meaningless, so adopt the other's
  // hue rather than rotating through arbitrary colours on the way there.
  const hue = a.sat < 0.5 ? b.hue : b.sat < 0.5 ? a.hue : lerpHue(a.hue, b.hue, t);
  return { hue, sat: lerp(a.sat, b.sat, t), lum: lerp(a.lum, b.lum, t) };
}

/**
 * Blend two solutions. Both must share curve x positions — the solver
 * guarantees this so the strength slider can interpolate without resampling.
 *
 * Masks are matched by region; a mask present in only one side fades in from
 * neutral rather than appearing abruptly at the midpoint.
 */
export function lerpAdjustments(a: Adjustments, b: Adjustments, t: number): Adjustments {
  const regions = new Set<RegionKey>([
    ...a.masks.map((m) => m.region),
    ...b.masks.map((m) => m.region),
  ]);
  const masks: MaskAdjustment[] = [];
  for (const region of regions) {
    const ma = a.masks.find((m) => m.region === region);
    const mb = b.masks.find((m) => m.region === region);
    const base = mb ?? ma!;
    const from = ma ?? { ...base, exposure: 0, temp: 0, tint: 0, saturation: 0, contrast: 0 };
    const to = mb ?? { ...base, exposure: 0, temp: 0, tint: 0, saturation: 0, contrast: 0 };
    masks.push({
      region,
      kind: base.kind,
      label: base.label,
      rationale: base.rationale,
      exposure: lerp(from.exposure, to.exposure, t),
      temp: lerp(from.temp, to.temp, t),
      tint: lerp(from.tint, to.tint, t),
      saturation: lerp(from.saturation, to.saturation, t),
      contrast: lerp(from.contrast, to.contrast, t),
    });
  }

  return clampAdjustments({
    exposure: lerp(a.exposure, b.exposure, t),
    contrast: lerp(a.contrast, b.contrast, t),
    highlights: lerp(a.highlights, b.highlights, t),
    shadows: lerp(a.shadows, b.shadows, t),
    whites: lerp(a.whites, b.whites, t),
    blacks: lerp(a.blacks, b.blacks, t),
    curve: a.curve.map((p, i) => ({ x: p.x, y: lerp(p.y, b.curve[i]?.y ?? p.y, t) })),
    temp: lerp(a.temp, b.temp, t),
    tint: lerp(a.tint, b.tint, t),
    vibrance: lerp(a.vibrance, b.vibrance, t),
    saturation: lerp(a.saturation, b.saturation, t),
    hsl: Object.fromEntries(
      HSL_KEYS.map((k) => [
        k,
        {
          hue: lerp(a.hsl[k].hue, b.hsl[k].hue, t),
          sat: lerp(a.hsl[k].sat, b.hsl[k].sat, t),
          lum: lerp(a.hsl[k].lum, b.hsl[k].lum, t),
        },
      ]),
    ) as Record<HslBand['key'], HslTriple>,
    grading: {
      global: lerpWheel(a.grading.global, b.grading.global, t),
      shadows: lerpWheel(a.grading.shadows, b.grading.shadows, t),
      midtones: lerpWheel(a.grading.midtones, b.grading.midtones, t),
      highlights: lerpWheel(a.grading.highlights, b.grading.highlights, t),
      blending: lerp(a.grading.blending, b.grading.blending, t),
      balance: lerp(a.grading.balance, b.grading.balance, t),
    },
    texture: lerp(a.texture, b.texture, t),
    clarity: lerp(a.clarity, b.clarity, t),
    dehaze: lerp(a.dehaze, b.dehaze, t),
    vignette: lerp(a.vignette, b.vignette, t),
    grainAmount: lerp(a.grainAmount, b.grainAmount, t),
    grainSize: lerp(a.grainSize, b.grainSize, t),
    grainRoughness: lerp(a.grainRoughness, b.grainRoughness, t),
    sharpenAmount: lerp(a.sharpenAmount, b.sharpenAmount, t),
    sharpenRadius: lerp(a.sharpenRadius, b.sharpenRadius, t),
    sharpenDetail: lerp(a.sharpenDetail, b.sharpenDetail, t),
    noiseReduction: lerp(a.noiseReduction, b.noiseReduction, t),
    colorNoiseReduction: lerp(a.colorNoiseReduction, b.colorNoiseReduction, t),
    masks,
  });
}

/**
 * The strength slider, 0..1.
 *
 * Deliberately piecewise so one control covers the whole useful range:
 *   0.0  no change at all
 *   0.5  the restrained solution (the default — adopts the reference's
 *        character, protects skin, respects the photo's own light)
 *   1.0  the faithful solution (closes the measured gap as far as the
 *        controls allow)
 */
export function atStrength(
  restrained: Adjustments,
  faithful: Adjustments,
  t: number,
): Adjustments {
  const s = clamp(t, 0, 1);
  const identity = identityAdjustments(restrained.curve.map((p) => p.x));
  return s <= 0.5
    ? lerpAdjustments(identity, restrained, s * 2)
    : lerpAdjustments(restrained, faithful, (s - 0.5) * 2);
}
