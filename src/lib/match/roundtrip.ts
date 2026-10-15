// The round trip: you applied a Style Match preset in Lightroom, exported the
// result, and dropped it back in. Three questions, answered separately because
// they have different honesty requirements.
//
//   1. How close did the edit get?          `compareEdit`
//      Always answerable. The finished export and the reference are two
//      measured photographs; the untouched original is the third. For each
//      quantity, how much of the gap between the original and the reference
//      the edit closed.
//
//   2. What would close the rest?           `followUpAdjustments`
//      A second solve, from the edited export to the reference. A Lightroom
//      preset sets ABSOLUTE slider values, so a corrective preset applied on
//      top would overwrite the first one rather than add to it. The follow-up
//      therefore carries the original values PLUS the correction — which is
//      only possible when we know what the original values were, i.e. when
//      the preset was applied unchanged. Otherwise the correction is offered
//      as moves to make by hand, never as a preset.
//
//   3. What did this teach us about Lightroom's sliders?   `calibrationRows`
//      Only when the conditions make the measurement mean something:
//      the preset was applied unchanged, it carried no masks, and "yours" was
//      a zero-slider Lightroom export — so the edited export differs from it
//      by exactly the preset and nothing else (see `roundTripEligibility`).
//      A full preset moves many controls at once, so a round trip is not a
//      single-control probe (scripts/match-calibrate.ts). Each measured
//      quantity is regressed jointly on every control that moves it, with
//      measured nuisance terms for the moves no calibration constant owns;
//      a constant only gets a value once enough varied round trips separate
//      it from the controls it always moves alongside.
//
// Pure. No I/O, no clock.

import {
  clampAdjustments,
  type Adjustments, type CurvePoint, type GradeWheel, type MaskAdjustment,
} from './adjustments';
import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
import { evalSpline } from './curve';
import { HSL_BANDS, type PhotoAnalysis } from './types';

// ─── 1. How close did the edit get ──────────────────────────────────────────

export interface GapRow {
  key: 'brightness' | 'contrast' | 'colourfulness' | 'cast' | 'grain' | 'vignette';
  label: string;
  /** Distance from the reference before the edit, and after it, in the
   *  quantity's own units. Null when it could not be measured on all three. */
  before: number | null;
  after: number | null;
  /** 0..1 of the gap closed; negative when the edit moved away from the
   *  reference; null when there was no real gap to close. */
  closed: number | null;
  /** One sentence, in the quantity's own terms. */
  text: string;
}

export interface EditComparison {
  rows: GapRow[];
  /** Mean of the rows that had a gap to close, 0..1 (can be negative). */
  overall: number | null;
}

/** Below these, a quantity was already matched and a percentage of it is noise. */
const NO_GAP = {
  brightness: 0.01, contrast: 0.01, colourfulness: 0.004, cast: 0.004, grain: 0.0015, vignette: 0.08,
};

const pct = (p: number[] | undefined, i: number) => (p && p.length === 21 ? p[i] : undefined);

export function compareEdit(mine: PhotoAnalysis, edited: PhotoAnalysis, reference: PhotoAnalysis): EditComparison {
  const g = (a: PhotoAnalysis) => a.regions.global;
  const scalar = (
    key: GapRow['key'], label: string,
    read: (a: PhotoAnalysis) => number | undefined,
    words: { more: string; less: string; unit: (d: number) => string },
  ): GapRow => {
    const m = read(mine), e = read(edited), r = read(reference);
    if (m === undefined || e === undefined || r === undefined) {
      return { key, label, before: null, after: null, closed: null, text: `${label}: not measurable on all three photos.` };
    }
    const before = Math.abs(m - r), after = Math.abs(e - r);
    const closed = before < NO_GAP[key] ? null : 1 - after / before;
    const crossed = Math.sign(m - r) !== Math.sign(e - r) && after >= NO_GAP[key];
    const side = e < r ? words.less : words.more;
    const text =
      closed === null ? (after < NO_GAP[key] * 2 ? `${label}: already matched, and still is.` : `${label}: was matched; the edit moved it ${side} than the reference by ${words.unit(after)}.`)
      : after < NO_GAP[key] ? `${label}: matched.`
      : crossed ? `${label}: overshot — now ${side} than the reference by ${words.unit(after)}.`
      : closed < 0 ? `${label}: moved away from the reference — now ${side} by ${words.unit(after)}.`
      : `${label}: ${Math.round(closed * 100)}% of the gap closed; still ${side} than the reference by ${words.unit(after)}.`;
    return { key, label, before, after, closed, text };
  };

  const rows: GapRow[] = [
    scalar('brightness', 'Brightness', (a) => pct(g(a)?.percentiles, 10),
      { more: 'brighter', less: 'darker', unit: (d) => `${(d * 100).toFixed(1)} L` }),
    scalar('contrast', 'Contrast', (a) => {
      const p = g(a)?.percentiles;
      return p && p.length === 21 ? p[19] - p[1] : undefined;
    }, { more: 'more contrasty', less: 'flatter', unit: (d) => `${(d * 100).toFixed(1)} L` }),
    scalar('colourfulness', 'Colourfulness', (a) => g(a)?.C.mean,
      { more: 'more colourful', less: 'less colourful', unit: (d) => `${(d * 1000).toFixed(0)} thousandths of chroma` }),
    castRow(mine, edited, reference),
    scalar('grain', 'Grain',
      (a) => (mine.texture.usable && edited.texture.usable && reference.texture.usable ? a.texture.grain : undefined),
      { more: 'grainier', less: 'cleaner', unit: (d) => d.toFixed(4) }),
    scalar('vignette', 'Vignette',
      (a) => (mine.vignette.usable && edited.vignette.usable && reference.vignette.usable ? a.vignette.falloffStops : undefined),
      { more: 'lighter in the corners', less: 'darker in the corners', unit: (d) => `${d.toFixed(2)} stops` }),
  ];
  const scored = rows.filter((r) => r.closed !== null).map((r) => Math.max(-1, r.closed!));
  return { rows, overall: scored.length ? scored.reduce((s, v) => s + v, 0) / scored.length : null };
}

/** Cast is a direction as well as an amount, so its gap is a distance in the
 *  a/b plane, not a difference of magnitudes. */
function castRow(mine: PhotoAnalysis, edited: PhotoAnalysis, reference: PhotoAnalysis): GapRow {
  const m = mine.regions.global?.ab, e = edited.regions.global?.ab, r = reference.regions.global?.ab;
  if (!m || !e || !r) return { key: 'cast', label: 'Colour cast', before: null, after: null, closed: null, text: 'Colour cast: not measurable on all three photos.' };
  const before = Math.hypot(m.a - r.a, m.b - r.b), after = Math.hypot(e.a - r.a, e.b - r.b);
  const closed = before < NO_GAP.cast ? null : 1 - after / before;
  const direction = (): string => {
    const da = r.a - e.a, db = r.b - e.b;
    const parts: string[] = [];
    if (Math.abs(db) > NO_GAP.cast / 2) parts.push(db > 0 ? 'warmer' : 'cooler');
    if (Math.abs(da) > NO_GAP.cast / 2) parts.push(da > 0 ? 'more magenta' : 'greener');
    return parts.length ? `the reference is ${parts.join(' and ')}` : 'the remaining difference is slight';
  };
  const text =
    closed === null ? (after < NO_GAP.cast * 2 ? 'Colour cast: already matched, and still is.' : `Colour cast: was matched; now ${direction()}.`)
    : after < NO_GAP.cast ? 'Colour cast: matched.'
    : closed < 0 ? `Colour cast: moved away from the reference — ${direction()}.`
    : `Colour cast: ${Math.round(closed * 100)}% of the gap closed; ${direction()}.`;
  return { key: 'cast', label: 'Colour cast', before, after, closed, text };
}

// ─── 2. The follow-up ───────────────────────────────────────────────────────

/** Read a point curve the way Lightroom draws it: a natural spline through
 *  the points (see curve.ts). */
export function evalCurve(curve: CurvePoint[], x: number): number {
  if (curve.length === 0) return x;
  return evalSpline(curve, x);
}

/** An exposure move expressed on the curve's gamma-encoded 0..255 scale. The
 *  2.2 gamma is an approximation of Lightroom's display curve, stated here
 *  because it is the one place this composition is not exact. */
const exposeEncoded = (y: number, stops: number): number =>
  255 * Math.min(1, Math.pow(Math.pow(Math.max(0, y) / 255, 2.2) * 2 ** stops, 1 / 2.2));

const polar = (w: GradeWheel) => {
  const r = (w.hue * Math.PI) / 180;
  return [w.sat * Math.cos(r), w.sat * Math.sin(r)] as const;
};
function addWheels(a: GradeWheel, b: GradeWheel): GradeWheel {
  const [ax, ay] = polar(a), [bx, by] = polar(b);
  const x = ax + bx, y = ay + by;
  const sat = Math.hypot(x, y);
  let hue = (Math.atan2(y, x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { hue: sat < 0.5 ? a.hue : hue, sat, lum: a.lum + b.lum };
}

/**
 * The preset to apply INSTEAD of the first one: its values plus the
 * correction solved from the edited export.
 *
 * Order matters for tone. The correction was solved on the export, i.e.
 * after the first preset's exposure and curve, so its own exposure and curve
 * are composed onto the end of the first curve — corrective(expose(first(x)))
 * — rather than added to the first exposure, which Lightroom applies before
 * any curve. Everything else is additive: sliders sum, wheels add as vectors,
 * masks for the same region sum and new ones are appended. Clamped last, so a
 * control already at its limit stays there and the note says so.
 */
export function followUpAdjustments(applied: Adjustments, corrective: Adjustments): Adjustments {
  const xs = [...new Set([...applied.curve.map((p) => p.x), 0, 32, 64, 96, 128, 160, 192, 224, 255])].sort((a, b) => a - b);
  const curve = xs.map((x) => ({
    x,
    y: evalCurve(corrective.curve, exposeEncoded(evalCurve(applied.curve, x), corrective.exposure)),
  }));
  const masks: MaskAdjustment[] = applied.masks.map((m) => ({ ...m }));
  for (const c of corrective.masks) {
    const same = masks.find((m) => m.region === c.region);
    if (!same) { masks.push({ ...c }); continue; }
    same.exposure += c.exposure; same.temp += c.temp; same.tint += c.tint;
    same.saturation += c.saturation; same.contrast += c.contrast;
  }
  const hsl = Object.fromEntries(
    HSL_BANDS.map(({ key }) => [key, {
      hue: applied.hsl[key].hue + corrective.hsl[key].hue,
      sat: applied.hsl[key].sat + corrective.hsl[key].sat,
      lum: applied.hsl[key].lum + corrective.hsl[key].lum,
    }]),
  ) as Adjustments['hsl'];
  const sum = (k: keyof Adjustments) => (applied[k] as number) + (corrective[k] as number);
  return clampAdjustments({
    ...applied,
    exposure: applied.exposure,
    // Descriptive only (the curve carries the real move) — kept in step so
    // the report still describes the curve it is printed beside.
    contrast: sum('contrast'), highlights: sum('highlights'), shadows: sum('shadows'),
    whites: sum('whites'), blacks: sum('blacks'),
    curve,
    temp: sum('temp'), tint: sum('tint'),
    vibrance: sum('vibrance'), saturation: sum('saturation'),
    hsl,
    grading: {
      global: addWheels(applied.grading.global, corrective.grading.global),
      shadows: addWheels(applied.grading.shadows, corrective.grading.shadows),
      midtones: addWheels(applied.grading.midtones, corrective.grading.midtones),
      highlights: addWheels(applied.grading.highlights, corrective.grading.highlights),
      blending: applied.grading.blending,
      balance: applied.grading.balance,
    },
    texture: sum('texture'), clarity: sum('clarity'), dehaze: sum('dehaze'), vignette: sum('vignette'),
    grainAmount: sum('grainAmount'),
    grainSize: corrective.grainAmount > 0 && applied.grainAmount === 0 ? corrective.grainSize : applied.grainSize,
    grainRoughness: corrective.grainAmount > 0 && applied.grainAmount === 0 ? corrective.grainRoughness : applied.grainRoughness,
    noiseReduction: sum('noiseReduction'),
    masks,
  });
}

export interface HandMove { panel: string; control: string; delta: string }

/**
 * The correction as moves to make by hand — for a round trip where the
 * preset was changed after applying it, so no absolute preset can be built.
 * Only moves big enough to see; the curve is summarised by what it does to
 * the midtones, since a list of point deltas is not something a hand can do.
 */
export function handMoves(c: Adjustments): HandMove[] {
  const out: HandMove[] = [];
  const signed = (v: number, dp = 0) => `${v > 0 ? '+' : ''}${v.toFixed(dp)}`;
  const mid = evalCurve(c.curve, 128) - 128;
  const expoEq = c.exposure + (Math.abs(mid) > 3 ? Math.log2(Math.pow(Math.max(1, 128 + mid) / 128, 2.2)) : 0);
  if (Math.abs(expoEq) >= 0.1) out.push({ panel: 'Light', control: 'Exposure', delta: signed(expoEq, 2) });
  if (Math.abs(c.contrast) >= 5) out.push({ panel: 'Light', control: 'Contrast', delta: signed(c.contrast) });
  for (const k of ['highlights', 'shadows', 'whites', 'blacks'] as const) {
    if (Math.abs(c[k]) >= 8) out.push({ panel: 'Light', control: k[0].toUpperCase() + k.slice(1), delta: signed(c[k]) });
  }
  if (Math.abs(c.vibrance) >= 4) out.push({ panel: 'Colour', control: 'Vibrance', delta: signed(c.vibrance) });
  if (Math.abs(c.saturation) >= 4) out.push({ panel: 'Colour', control: 'Saturation', delta: signed(c.saturation) });
  if (c.grading.global.sat >= 4) {
    out.push({ panel: 'Colour Grading', control: 'Global', delta: `add ${Math.round(c.grading.global.sat)} saturation at hue ${Math.round(c.grading.global.hue)}°` });
  }
  for (const { key, label } of HSL_BANDS) {
    const t = c.hsl[key];
    for (const f of ['hue', 'sat', 'lum'] as const) {
      if (Math.abs(t[f]) >= 6) out.push({ panel: 'Colour Mixer', control: `${label} ${f === 'sat' ? 'Saturation' : f === 'lum' ? 'Luminance' : 'Hue'}`, delta: signed(t[f]) });
    }
  }
  if (Math.abs(c.texture) >= 6) out.push({ panel: 'Effects', control: 'Texture', delta: signed(c.texture) });
  if (Math.abs(c.vignette) >= 6) out.push({ panel: 'Effects', control: 'Vignette', delta: signed(c.vignette) });
  if (c.grainAmount >= 5) out.push({ panel: 'Effects', control: 'Grain', delta: signed(c.grainAmount) });
  return out;
}

// ─── 3. Calibration ────────────────────────────────────────────────────────

export type AppliedAs = 'unchanged' | 'changed';

export interface EligibilityInput {
  appliedAs: AppliedAs;
  /** What "yours" was measured from when the match was made. */
  baseline: PhotoAnalysis['baseline'];
  /** Whether the preset file that was applied carried any masks. */
  hadMasks: boolean;
  mine: { width: number; height: number };
  edited: { width: number; height: number };
}

/**
 * Whether a round trip may teach the calibration anything, and if not, why.
 * Every reason is one the person can act on next time.
 */
export function roundTripEligibility(i: EligibilityInput): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (i.appliedAs !== 'unchanged') {
    reasons.push('The preset was changed after applying it, so what moved the pixels is not known.');
  }
  if (i.baseline !== 'export') {
    reasons.push('“Yours” was not a zero-slider Lightroom export, so the difference also contains Lightroom’s own rendering of the file, not only the preset.');
  }
  if (i.hadMasks) {
    reasons.push('The preset carried masks, which Lightroom regenerates on import — their effect on each region cannot be separated. Use “Without masks” for a round trip meant to calibrate.');
  }
  const ar = (d: { width: number; height: number }) => d.width / Math.max(1, d.height);
  if (Math.abs(ar(i.mine) / ar(i.edited) - 1) > 0.01) {
    reasons.push('The export is cropped differently from the original, which changes every measurement of the frame.');
  }
  return { eligible: reasons.length === 0, reasons };
}

/** One observation: a measured change and the slider values that caused it. */
export interface CalRow {
  group: CalGroup;
  /** Regressor values, by name. Calibrated controls use the Adjustments field
   *  name; nuisance terms are prefixed `~`. */
  x: Record<string, number>;
  y: number;
  /** The round trip it came from. One photo yields a row per colour band,
   *  and those share the photo's own error — so evidence is counted in
   *  round trips, not rows. Set when rows are read back from disk. */
  source?: string;
}

export type CalGroup = 'chroma' | 'cast' | 'hslSat' | 'hslLum' | 'hslHue' | 'grain' | 'acutance' | 'vignette';

/** How a calibrated regressor's fitted slope turns into its constant — the
 *  same forward formulas scripts/match-calibrate.ts inverts. */
interface Target {
  key: keyof Calibration;
  label: string;
  group: CalGroup;
  regressor: string;
  toConstant: (slope: number) => number;
  /** Smallest slider move that counts as a point for this constant. */
  minMove: number;
}

export const CAL_TARGETS: Target[] = [
  { key: 'saturationGain', label: 'Saturation', group: 'chroma', regressor: 'saturation', toConstant: (s) => 1 / (100 * s), minMove: 5 },
  { key: 'vibranceGain', label: 'Vibrance', group: 'chroma', regressor: 'vibrance', toConstant: (s) => 1 / (100 * s), minMove: 5 },
  { key: 'colorGradeUnit', label: 'Colour Grading › Global', group: 'cast', regressor: 'gradeGlobalSat', toConstant: (s) => 100 * s, minMove: 5 },
  { key: 'hslSaturationGain', label: 'Colour Mixer › Saturation', group: 'hslSat', regressor: 'hslSat', toConstant: (s) => 1 / (100 * s), minMove: 8 },
  { key: 'hslLuminanceGain', label: 'Colour Mixer › Luminance', group: 'hslLum', regressor: 'hslLum', toConstant: (s) => 1 / s, minMove: 8 },
  { key: 'hslHueDegreesAt100', label: 'Colour Mixer › Hue', group: 'hslHue', regressor: 'hslHue', toConstant: (s) => 100 * s, minMove: 8 },
  { key: 'grainUnit', label: 'Grain', group: 'grain', regressor: 'grainAmount', toConstant: (s) => 100 * s, minMove: 5 },
  { key: 'noiseReductionUnit', label: 'Noise Reduction', group: 'grain', regressor: 'noiseReduction', toConstant: (s) => -100 * s, minMove: 5 },
  { key: 'textureUnit', label: 'Texture', group: 'acutance', regressor: 'texture', toConstant: (s) => 100 * s, minMove: 5 },
  { key: 'vignetteStopsAt100', label: 'Vignette', group: 'vignette', regressor: 'vignette', toConstant: (s) => 100 * s, minMove: 5 },
];

/** Constants a round trip can never teach, and why — shown so their absence
 *  from the proposal reads as a fact, not an omission. */
export const NOT_FROM_ROUND_TRIPS: Array<{ key: keyof Calibration; why: string }> = [
  { key: 'tempUnit', why: 'The preset never writes Temp — it routes the cast through Colour Grading — so no round trip moves it. The probe harness can.' },
  { key: 'tintUnit', why: 'Same as Temp: never written to a preset.' },
  { key: 'tempKelvinPer100', why: 'A relabelling for RAW files, not a slider response; nothing here can measure it.' },
  { key: 'sharpenUnit', why: 'The solver never advises Sharpening, so there is nothing to calibrate against.' },
  { key: 'localTempUnit', why: 'Mask adjustments; round trips that calibrate are mask-free by design.' },
  { key: 'localTintUnit', why: 'Mask adjustments; see above.' },
  { key: 'localSaturationGain', why: 'Mask adjustments; see above.' },
];

/** The integer values the .xmp actually carried (xmp.ts rounds signed
 *  controls), so a regression never credits a slider with a fraction
 *  Lightroom was never given. */
const r = Math.round;

/**
 * Turn one eligible round trip into regression rows.
 *
 * `base` is the zero-slider export the match measured; `edited` the same
 * photo with the preset applied. Where a control outside a group also moves
 * that group's quantity, its effect enters as a *measured* nuisance term —
 * the tone change read off the two photos' own percentiles, the cast shift
 * read off their own a/b — rather than predicted from another constant that
 * may itself be wrong.
 */
export function calibrationRows(base: PhotoAnalysis, edited: PhotoAnalysis, applied: Adjustments): CalRow[] {
  const rows: CalRow[] = [];
  const bg = base.regions.global, eg = edited.regions.global;
  if (!bg || !eg) return rows;

  const chromaRatio = bg.C.mean > 1e-4 ? eg.C.mean / bg.C.mean : null;
  const toneRatio = bg.L.mean > 1e-4 ? eg.L.mean / bg.L.mean - 1 : 0;

  // Chroma: Saturation and Vibrance both scale it; OKLab chroma also follows
  // lightness, so the measured tone change is a nuisance term.
  if (chromaRatio !== null) {
    rows.push({
      group: 'chroma',
      x: { saturation: r(applied.saturation), vibrance: r(applied.vibrance), '~tone': toneRatio, '~grade': r(applied.grading.global.sat) },
      y: chromaRatio - 1,
    });
  }

  // Cast: the shift of mean a/b, with the part that is only the existing
  // cast being scaled (by Saturation) taken out using the measured ratio.
  const castShift = chromaRatio !== null
    ? { a: eg.ab.a - chromaRatio * bg.ab.a, b: eg.ab.b - chromaRatio * bg.ab.b }
    : null;
  if (castShift) {
    rows.push({
      group: 'cast',
      x: { gradeGlobalSat: r(applied.grading.global.sat), '~zones': r(applied.grading.shadows.sat + applied.grading.midtones.sat + applied.grading.highlights.sat) },
      y: Math.hypot(castShift.a, castShift.b),
    });
  }

  // Tone transfer read off the photos themselves: where base lightness L
  // ended up in the edit, by matching percentiles.
  const toneAt = (L: number): number => {
    const bp = bg.percentiles, ep = eg.percentiles;
    if (bp.length !== 21 || ep.length !== 21) return L;
    for (let i = 1; i < 21; i++) {
      if (L <= bp[i] || i === 20) {
        const t = (L - bp[i - 1]) / Math.max(1e-6, bp[i] - bp[i - 1]);
        return ep[i - 1] + Math.max(0, Math.min(1, t)) * (ep[i] - ep[i - 1]);
      }
    }
    return L;
  };

  HSL_BANDS.forEach(({ key }, i) => {
    const b = base.hslBands[i], e = edited.hslBands[i];
    if (!b || !e || b.weight < 0.02 || e.weight < 0.02) return;
    const t = applied.hsl[key];
    if (chromaRatio !== null && b.chroma >= 0.02) {
      // Relative to the frame's own chroma change, so the global Saturation
      // and Vibrance moves (and tone) cancel out of a band's reading.
      rows.push({ group: 'hslSat', x: { hslSat: r(t.sat) }, y: e.chroma / b.chroma / chromaRatio - 1 });
    }
    rows.push({ group: 'hslLum', x: { hslLum: r(t.lum) }, y: e.L - toneAt(b.L) });
    if (b.chroma >= 0.06 && castShift) {
      // How far the measured cast shift alone would rotate this band's mean
      // colour — the nuisance a Colour Grading move adds to a hue reading.
      const h = (b.hue * Math.PI) / 180;
      const a0 = b.chroma * Math.cos(h), b0 = b.chroma * Math.sin(h);
      const castTurn = angleDiff(Math.atan2(b0 + castShift.b, a0 + castShift.a), Math.atan2(b0, a0));
      rows.push({ group: 'hslHue', x: { hslHue: r(t.hue), '~cast': castTurn }, y: angleDeg(e.hue - b.hue) });
    }
  });

  const texturesComparable = base.texture.usable && edited.texture.usable &&
    base.texture.normalised === edited.texture.normalised;
  if (texturesComparable) {
    rows.push({
      group: 'grain',
      x: { grainAmount: r(applied.grainAmount), noiseReduction: r(applied.noiseReduction), '~texture': r(applied.texture) },
      y: edited.texture.grain - base.texture.grain,
    });
    rows.push({
      group: 'acutance',
      x: { texture: r(applied.texture), '~clarity': r(applied.clarity), '~grain': r(applied.grainAmount), '~nr': r(applied.noiseReduction) },
      y: edited.texture.acutance - base.texture.acutance,
    });
  }
  if (base.vignette.usable && edited.vignette.usable) {
    rows.push({ group: 'vignette', x: { vignette: r(applied.vignette) }, y: edited.vignette.falloffStops - base.vignette.falloffStops });
  }
  return rows;
}

const angleDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const angleDiff = (a: number, b: number) => angleDeg(((a - b) * 180) / Math.PI);

export type ProposalStatus = 'fitted' | 'needs-more' | 'confounded' | 'uncertain' | 'implausible';

export interface CalProposal {
  key: keyof Calibration;
  label: string;
  status: ProposalStatus;
  /** Round trips where this control actually moved. */
  points: number;
  current: number;
  estimate: number;
  /** Only when status is 'fitted', 'uncertain' or 'implausible'. */
  value?: number;
  /** Standard error relative to the value, 0..∞. */
  relError?: number;
  /** Why it has that status, in one sentence. */
  text: string;
}

/** Points below which a constant is not fitted at all. */
export const MIN_POINTS = 3;
/** Relative standard error above which a fit is shown but not offered. */
const MAX_REL_ERROR = 0.35;
/** A fit this far from the estimate almost always means a misapplied round
 *  trip, not an estimate that was that wrong. */
const PLAUSIBLE_FACTOR = 5;
/** Condition number of the column-normalised design above which two
 *  regressors are moving too much in step to separate. */
const MAX_CONDITION = 60;

/**
 * Fit every constant a round trip can teach, from all rows collected so far.
 * `current` is what the solver uses today (the estimate, or an approved fit).
 */
export function fitCalibration(rows: CalRow[], current: Calibration = DEFAULT_CALIBRATION): CalProposal[] {
  const out: CalProposal[] = [];
  const byGroup = new Map<CalGroup, CalRow[]>();
  for (const row of rows) {
    if (!byGroup.has(row.group)) byGroup.set(row.group, []);
    byGroup.get(row.group)!.push(row);
  }
  const fits = new Map<CalGroup, ReturnType<typeof olsThroughOrigin>>();

  for (const t of CAL_TARGETS) {
    const base = { key: t.key, label: t.label, current: current[t.key], estimate: DEFAULT_CALIBRATION[t.key] };
    const group = byGroup.get(t.group) ?? [];
    const points = new Set(
      group.flatMap((row, i) => (Math.abs(row.x[t.regressor] ?? 0) >= t.minMove ? [row.source ?? `#${i}`] : [])),
    ).size;
    if (points < MIN_POINTS) {
      out.push({ ...base, status: 'needs-more', points, text: `${points} of ${MIN_POINTS} round trips needed where ${t.label} actually moved.` });
      continue;
    }
    if (!fits.has(t.group)) fits.set(t.group, olsThroughOrigin(group));
    const fit = fits.get(t.group)!;
    const j = fit.names.indexOf(t.regressor);
    if (!fit.ok || j < 0) {
      const partner = fit.collinearWith?.(t.regressor);
      out.push({
        ...base, status: 'confounded', points,
        text: partner
          ? `${t.label} has always moved in step with ${partnerLabel(partner)}, so their effects cannot be told apart yet.`
          : 'Not enough variety across round trips to separate this control from the others that move the same measurement.',
      });
      continue;
    }
    const slope = fit.beta[j];
    const value = t.toConstant(slope);
    const relError = Math.abs(fit.se[j] / slope);
    const sameSign = Math.sign(value) === Math.sign(base.estimate);
    const ratio = Math.abs(value / base.estimate);
    if (!Number.isFinite(value) || !sameSign || ratio > PLAUSIBLE_FACTOR || ratio < 1 / PLAUSIBLE_FACTOR) {
      out.push({ ...base, status: 'implausible', points, value, relError, text: `Fitted ${fmt(value)}, which is too far from the estimate (${fmt(base.estimate)}) to trust — usually a round trip that was not applied as recorded.` });
    } else if (!(relError <= MAX_REL_ERROR)) {
      out.push({ ...base, status: 'uncertain', points, value, relError, text: `Fitted ${fmt(value)} ± ${Math.round(relError * 100)}% — too noisy to apply yet.` });
    } else {
      out.push({ ...base, status: 'fitted', points, value, relError, text: `Fitted ${fmt(value)} ± ${Math.round(relError * 100)}% from ${points} round trips.` });
    }
  }
  return out;
}

const partnerLabel = (name: string): string =>
  CAL_TARGETS.find((t) => t.regressor === name)?.label ??
  ({ '~tone': 'the tone change', '~grade': 'Colour Grading', '~zones': 'the zone wheels', '~cast': 'the cast shift', '~texture': 'Texture', '~clarity': 'Clarity', '~grain': 'Grain', '~nr': 'Noise Reduction' } as Record<string, string>)[name] ??
  name;

const fmt = (v: number): string => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));

/**
 * Least squares through the origin over the regressors that ever move.
 * Returns the slopes, their standard errors, and — when the design is too
 * ill-conditioned to trust — which pair is moving in step.
 */
export function olsThroughOrigin(rows: CalRow[]): {
  ok: boolean; names: string[]; beta: number[]; se: number[]; condition: number;
  collinearWith?: (name: string) => string | undefined;
} {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row.x)))]
    .filter((n) => rows.some((row) => Math.abs(row.x[n] ?? 0) > 1e-9));
  const p = names.length, n = rows.length;
  const X = rows.map((row) => names.map((k) => row.x[k] ?? 0));
  const y = rows.map((row) => row.y);
  const norms = names.map((_, j) => Math.sqrt(X.reduce((s, xi) => s + xi[j] * xi[j], 0)) || 1);
  const Z = X.map((xi) => xi.map((v, j) => v / norms[j]));
  const ZtZ = names.map((_, a) => names.map((_, b) => Z.reduce((s, zi) => s + zi[a] * zi[b], 0)));
  const eig = symmetricEigenvalues(ZtZ);
  const condition = eig.length ? Math.max(...eig) / Math.max(1e-12, Math.min(...eig)) : Infinity;
  const collinearWith = (name: string): string | undefined => {
    const a = names.indexOf(name);
    if (a < 0) return undefined;
    let best: string | undefined, bc = 0;
    names.forEach((other, b) => {
      if (b === a) return;
      const c = Math.abs(ZtZ[a][b]);
      if (c > bc) { bc = c; best = other; }
    });
    return bc > 0.97 ? best : undefined;
  };
  if (p === 0 || n <= p || condition > MAX_CONDITION) {
    return { ok: false, names, beta: [], se: [], condition, collinearWith };
  }
  const Zty = names.map((_, a) => Z.reduce((s, zi, i) => s + zi[a] * y[i], 0));
  const inv = invert(ZtZ);
  if (!inv) return { ok: false, names, beta: [], se: [], condition, collinearWith };
  const gamma = inv.map((row) => row.reduce((s, v, b) => s + v * Zty[b], 0));
  const rss = Z.reduce((s, zi, i) => s + (y[i] - zi.reduce((t, v, b) => t + v * gamma[b], 0)) ** 2, 0);
  const sigma2 = rss / (n - p);
  const beta = gamma.map((g, j) => g / norms[j]);
  const se = inv.map((row, j) => Math.sqrt(Math.max(0, sigma2 * row[j])) / norms[j]);
  return { ok: true, names, beta, se, condition, collinearWith };
}

/** Gauss–Jordan with partial pivoting; null when singular. Tiny matrices only. */
function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...row.map((_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let rr = c + 1; rr < n; rr++) if (Math.abs(a[rr][c]) > Math.abs(a[piv][c])) piv = rr;
    if (Math.abs(a[piv][c]) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    const d = a[c][c];
    for (let k = 0; k < 2 * n; k++) a[c][k] /= d;
    for (let rr = 0; rr < n; rr++) {
      if (rr === c) continue;
      const f = a[rr][c];
      for (let k = 0; k < 2 * n; k++) a[rr][k] -= f * a[c][k];
    }
  }
  return a.map((row) => row.slice(n));
}

/** Jacobi rotation — exact enough for the ≤5×5 symmetric matrices here. */
function symmetricEigenvalues(m: number[][]): number[] {
  const n = m.length;
  const a = m.map((row) => [...row]);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return a.map((row, i) => row[i]);
}

/** Merge approved values over the estimates. Unknown keys are ignored, so a
 *  stale file from an older Calibration shape cannot inject a field. */
export function withApproved(approved: Partial<Record<keyof Calibration, number>>): Calibration {
  const cal: Calibration = { ...DEFAULT_CALIBRATION };
  for (const key of Object.keys(DEFAULT_CALIBRATION) as Array<keyof Calibration>) {
    const v = approved[key];
    if (typeof v === 'number' && Number.isFinite(v)) cal[key] = v;
  }
  return cal;
}

