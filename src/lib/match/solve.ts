import {
  clampAdjustments,
  identityAdjustments,
  zeroHsl,
  type Adjustments,
  type CurvePoint,
  type GradeWheel,
  type MaskAdjustment,
} from './adjustments';
import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
// From texture-core, not texture: the solver runs in the browser on the offline
// fallback path, and texture.ts pulls in sharp.
import { textureComparable } from './texture-core';
import {
  BASELINE_FIDELITY,
  HSL_BANDS,
  REGION_LABEL,
  type HslBandStats,
  type PhotoAnalysis,
  type RegionKey,
  type RegionStats,
} from './types';

// The solver: measurements in, Lightroom values out.
//
// ── The one architectural idea ──────────────────────────────────────────────
// Controls are assigned in a fixed order, and each one closes only the gap the
// previous ones left behind. A running PREDICTED STATE of the user's photo is
// updated after every stage, so Saturation never re-corrects what the Colour
// Mixer already handled, and a Sky mask only carries what survived the global
// grade. Without this, a naive solver that computed every control against the
// original measurement would triple-count the same colour cast and produce a
// wildly over-graded result that still looked "mathematically justified".
//
// Order (each operating on the residual):
//   1. Exposure            overall level
//   2. Tone curve          tone shape
//   3. Saturation          overall chroma level
//   4. Colour Grading glob. overall colour cast
//   5. Colour Mixer        per-hue-band deviation from the global move
//   6. Colour Grading S/M/H per-zone colour deviation
//   7. Masks               per-region residual
//   8. Effects / Detail    grain, texture, noise, vignette
//
// ── Why the tone move is Exposure + Curve, not the Basic sliders ────────────
// Exposure is a pure luminance scale, so it is exactly solvable. The curve is
// exactly solvable too: matching two luminance CDFs IS a curve, with no model
// of Adobe's internals required. Highlights/Shadows/Whites/Blacks, by contrast,
// are proprietary non-linear functions that cannot be inverted honestly.
//
// So the preset carries Exposure + Curve, and the Basic sliders are computed as
// DESCRIPTIVE equivalents for display only. Applying both would double the move
// — `basicSlidersAreDescriptive` records this, and the .xmp writer skips them.

/**
 * Percentile indices used as curve control points: 5, 15, 30, 50, 70, 85, 95%.
 *
 * The extremes (0 and 100) are deliberately excluded. Percentile 100 is the
 * single brightest pixel in the frame — usually a specular highlight or a
 * clipped one — and anchoring a control point to it produced a near-vertical
 * final segment that slammed the highlights. Percentile 0 has the same problem
 * at the bottom. The curve is anchored at (0,0) and (255,255) instead, so it
 * spans the full domain without letting one outlier pixel define its shape.
 */
const CURVE_TAPS = [1, 3, 6, 10, 14, 17, 19];

/** Percentile indices used to fit Exposure — the mid-range only, for the same
 *  outlier reason. 10% through 90%. */
const EXPOSURE_TAPS = [2, 4, 6, 8, 10, 12, 14, 16, 18];

/** Minimum x separation between curve control points, in 0..255 units. */
const MIN_TAP_SPACING = 14;

/** Steepest interior curve segment allowed. Above roughly 3 the result bands. */
const MAX_CURVE_SLOPE = 3;

/** Ceiling on a single mask's exposure move. Beyond this a mask stops being a
 *  correction and starts rebuilding the photograph — and on a large region it
 *  looks obviously wrong. */
const MASK_MAX_EXPOSURE = { faithful: 1.0, restrained: 0.5 };

/** A hue with a weaker resultant than this is not a hue — it is cancelled-out
 *  noise, and acting on it invents a target. */
const MIN_HUE_STRENGTH = 0.3;

/** HSL bands below this share of chromatic pixels are treated as absent. */
const BAND_PRESENT = 0.02;

/** Region residuals smaller than these are left alone: below the level at which
 *  a mask is worth the complexity, and within measurement noise. */
const MASK_MIN_EXPOSURE = 0.12; // stops
const MASK_MIN_COLOUR = 0.012; // OKLab a/b units
const MASK_MIN_SAT = 6; // slider units

/** Restrained-solution damping. Applied to every move, then skin is damped
 *  further still. */
const RESTRAINED_DAMP = 0.62;

/**
 * Absolute ceilings for the restrained solution.
 *
 * Damping alone is not restraint. Scaling an enormous move by 0.62 leaves an
 * enormous move: matching a green forest to an orange street scene produced a
 * 1.66x chroma boost plus a heavy green cast at the *restrained* setting, and
 * the preview came out neon. Proportional damping preserves the shape of a
 * grade but cannot decide that a grade is simply too much.
 *
 * These caps encode the other half: the restrained solution adopts the
 * reference's CHARACTER — where it puts warmth, how it treats skin, which way
 * it pushes each hue — without adopting its magnitude. The faithful solution
 * remains uncapped for anyone who does want the literal match.
 */
const RESTRAINED_CAPS = {
  /** Max/min multiplier on overall chroma. */
  chromaUp: 0.3,
  chromaDown: -0.25,
  /**
   * Colour cast ceilings, as a FRACTION OF THE PHOTO'S OWN MEAN CHROMA rather
   * than as fixed slider numbers.
   *
   * A fixed cap cannot know whether it is reasonable. Capping Colour Grading at
   * saturation 42 sounded conservative, but on a muted frame (mean chroma
   * 0.036) it still added 0.025 of cast, and the global and per-zone wheels
   * stacked on top of each other — more colour than the photograph contained,
   * pushed all one way. The preview came out fluorescent at the *restrained*
   * setting.
   *
   * Scaling to the photo's own chroma makes the ceiling mean the same thing on
   * every image: tint it, do not repaint it.
   */
  globalCastOfChroma: 0.4,
  zoneCastOfChroma: 0.25,
  /** Per-band Colour Mixer moves. */
  hslSat: 32,
  hslLum: 26,
  hslHue: 20,
};
const RESTRAINED_CURVE_PULL = 0.5;
const RESTRAINED_MAX_EXPOSURE = 1.2;
const SKIN_DAMP = 0.35;

export interface MatchNote {
  severity: 'info' | 'caution';
  /** Which panel this concerns, for grouping in the UI. */
  panel: string;
  text: string;
}

export interface MatchSolution {
  restrained: Adjustments;
  faithful: Adjustments;
  /** Shared curve x positions, so the strength slider can blend without
   *  resampling. */
  curveX: number[];
  notes: MatchNote[];
  /** True whenever contrast/highlights/shadows/whites/blacks are display-only
   *  equivalents of the curve rather than values to apply alongside it. */
  basicSlidersAreDescriptive: true;
  /** 0..1 — how much the inputs justify trusting the result. Driven by baseline
   *  fidelity and by how much of each frame could actually be compared. */
  confidence: number;
  /** 0..1 — how much of the measured gap the controls can actually close.
   *  Distinct from `confidence`: a perfectly-measured pair of unrelated photos
   *  has high confidence and low reachability. */
  reachability: number;
  /** RMS OKLab error across zones after solving — how well the colour grading
   *  replication actually landed. Lower is better; below ~0.01 is a close match. */
  colourResidual: number;
}

// --- Colour helpers -----------------------------------------------------------

const srgbEncode = (y: number): number => {
  const x = Math.max(0, Math.min(1, y));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};

/** OKLab -> linear sRGB (Ottosson's inverse matrices). */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Convert an OKLab a/b direction into Lightroom's Colour Grading hue.
 *
 * These are different colour spaces with different hue conventions — OKLCH's
 * 145 deg is not Lightroom's 145 deg. Rather than a fudge table, we build an
 * actual colour in that direction, take it to sRGB, and read its HSV hue, which
 * IS the convention Lightroom's wheels use (0 red, 120 green, 240 blue).
 */
function oklabDirectionToLightroomHue(da: number, db: number): number {
  const mag = Math.hypot(da, db);
  if (mag < 1e-9) return 0;
  const scale = 0.12 / mag; // a mid-chroma colour in that direction
  const [lr, lg, lb] = oklabToLinearSrgb(0.62, da * scale, db * scale);
  const r = srgbEncode(lr);
  const g = srgbEncode(lg);
  const b = srgbEncode(lb);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-9) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return (h % 360 + 360) % 360;
}

const circDelta = (from: number, to: number): number => {
  let d = ((to - from) % 360 + 540) % 360 - 180;
  return d;
};

const clampTo = (v: number, limit: number): number =>
  Number.isFinite(v) ? Math.max(-limit, Math.min(limit, v)) : 0;

/**
 * How much of the measured gap actually closed.
 *
 * Because every stage applies only what its clamped slider can deliver, the gap
 * remaining in the final state IS the unreachable remainder. This is the number
 * that distinguishes "here is your grade" from "these two photographs cannot be
 * made to match, and here is why" — which matters most for exactly the pairing
 * a person is most likely to try: a look they admire, on a photo that has
 * nothing in common with it.
 */
function reachabilityOf(ref: PhotoAnalysis, finalGlobal: Sample): number {
  const g = ref.regions.global;
  if (!g) return 0;
  const dL = Math.abs(g.L.mean - finalGlobal.L);
  const dAb = Math.hypot(g.ab.a - finalGlobal.a, g.ab.b - finalGlobal.b);
  // 0.10 in L and 0.06 in OKLab a/b are roughly "obviously different at a glance".
  const score = 1 - (dL / 0.1 + dAb / 0.06) / 2;
  return Math.max(0, Math.min(1, score));
}

// --- Predicted state ----------------------------------------------------------

interface Sample {
  L: number;
  C: number;
  a: number;
  b: number;
}

const sampleOf = (r: RegionStats): Sample => ({ L: r.L.mean, C: r.C.mean, a: r.ab.a, b: r.ab.b });

interface State {
  percentiles: number[];
  regions: Map<RegionKey, Sample>;
  bands: HslBandStats[];
}

function initialState(a: PhotoAnalysis): State {
  const regions = new Map<RegionKey, Sample>();
  for (const [key, stats] of Object.entries(a.regions) as Array<[RegionKey, RegionStats]>) {
    regions.set(key, sampleOf(stats));
  }
  return {
    percentiles: [...(a.regions.global?.percentiles ?? [])],
    regions,
    bands: a.hslBands.map((b) => ({ ...b })),
  };
}

/** Scale every lightness by an exposure in stops. Y = L^3, so L scales by
 *  2^(stops/3). */
function applyExposure(s: State, stops: number): void {
  const k = Math.pow(2, stops / 3);
  s.percentiles = s.percentiles.map((v) => Math.min(1, v * k));
  for (const v of s.regions.values()) v.L = Math.min(1, v.L * k);
  for (const b of s.bands) b.L = Math.min(1, b.L * k);
}

/** Apply a curve expressed in Lightroom's 0..255 space to the state's OKLab L
 *  values, matching what the preview shader will do. */
function applyCurve(s: State, curve: CurvePoint[]): void {
  const map = (L: number): number => {
    const x = srgbEncode(Math.max(0, Math.min(1, L)) ** 3) * 255;
    // Piecewise-linear through the control points.
    let i = 0;
    while (i < curve.length - 2 && curve[i + 1].x < x) i++;
    const p0 = curve[i];
    const p1 = curve[i + 1] ?? curve[i];
    const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x);
    const y = (p0.y + (p1.y - p0.y) * Math.max(0, Math.min(1, t))) / 255;
    // Back to OKLab L: invert the sRGB encode, then cube-root.
    const lin = y <= 0.04045 ? y / 12.92 : Math.pow((y + 0.055) / 1.055, 2.4);
    return Math.cbrt(Math.max(0, lin));
  };
  s.percentiles = s.percentiles.map(map);
  for (const v of s.regions.values()) v.L = map(v.L);
  for (const b of s.bands) b.L = map(b.L);
}

function applyChromaScale(s: State, ratio: number): void {
  for (const v of s.regions.values()) {
    v.C *= ratio;
    v.a *= ratio;
    v.b *= ratio;
  }
  for (const b of s.bands) b.chroma *= ratio;
}

function applyColourOffset(s: State, da: number, db: number): void {
  for (const v of s.regions.values()) {
    v.a += da;
    v.b += db;
    v.C = Math.hypot(v.a, v.b);
  }
}

const circGap = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/**
 * Fold the Colour Mixer's effect into the running state.
 *
 * Without this the Mixer was the one stage that adjusted nothing downstream:
 * the zone wheels and every mask were computed against a state that had not
 * seen it, so they re-corrected colour the Mixer had already moved. Band
 * weighting matches the renderer's exactly (squared cosine-ish falloff over a
 * 55 degree window, normalised) so the prediction and the preview agree.
 */
function applyMixer(
  s: State,
  hsl: Record<string, { hue: number; sat: number; lum: number }>,
  cal: Calibration,
): void {
  for (const v of s.regions.values()) {
    const C = Math.hypot(v.a, v.b);
    if (C < 0.004) continue;
    let hue = (Math.atan2(v.b, v.a) * 180) / Math.PI;
    if (hue < 0) hue += 360;

    let wsum = 0;
    let rot = 0;
    let chroma = 0;
    let lum = 0;
    for (const band of HSL_BANDS) {
      const d = circGap(hue, band.H);
      let w = Math.max(0, 1 - d / 55);
      w *= w;
      if (w <= 0) continue;
      const adj = hsl[band.key];
      wsum += w;
      rot += w * (adj.hue / 100) * cal.hslHueDegreesAt100;
      chroma += w * (1 + adj.sat / (100 * cal.hslSaturationGain));
      lum += w * (adj.lum / cal.hslLuminanceGain);
    }
    if (wsum <= 1e-4) continue;
    const nh = ((hue + rot / wsum) * Math.PI) / 180;
    const nc = C * (chroma / wsum);
    v.a = nc * Math.cos(nh);
    v.b = nc * Math.sin(nh);
    v.C = nc;
    v.L = Math.max(0, Math.min(1, v.L + lum / wsum));
  }
}

/** Luminance-zone weights — must match stats-core.zoneWeights and the shader. */
function zoneW(L: number): [number, number, number] {
  const sh = Math.max(0, 1 - L / 0.5);
  const hi = Math.max(0, (L - 0.5) / 0.5);
  const mid = Math.max(0, 1 - Math.abs(L - 0.5) / 0.5);
  const t = sh + mid + hi;
  return t > 0 ? [sh / t, mid / t, hi / t] : [0, 1, 0];
}

/**
 * Fold the three Colour Grading wheels into the running state, weighted by each
 * region's own luminance. Same omission as the Mixer above: without it, every
 * mask re-corrects the tint the wheels just applied.
 */
function applyZoneTints(
  s: State,
  devs: { shadow: [number, number]; mid: [number, number]; high: [number, number] },
): void {
  for (const v of s.regions.values()) {
    const [ws, wm, wh] = zoneW(v.L);
    v.a += ws * devs.shadow[0] + wm * devs.mid[0] + wh * devs.high[0];
    v.b += ws * devs.shadow[1] + wm * devs.mid[1] + wh * devs.high[1];
    v.C = Math.hypot(v.a, v.b);
  }
}

// --- Fitting ------------------------------------------------------------------

/** Fit the point curve that maps `from` percentiles onto `to` percentiles.
 *  This is histogram matching, restricted to Lightroom's curve control points. */
function fitCurve(from: number[], to: number[]): { points: CurvePoint[]; x: number[] } {
  const pts: CurvePoint[] = [{ x: 0, y: 0 }];
  let lastX = 0;
  for (const i of CURVE_TAPS) {
    if (i >= from.length || i >= to.length) continue;
    const x = Math.round(srgbEncode(from[i] ** 3) * 255);
    const y = Math.round(srgbEncode(to[i] ** 3) * 255);
    // Two taps close together in x but far apart in y produce a near-vertical
    // segment — visible as harsh banding, and never what a person would draw.
    // It happens whenever the source photo has compressed tones somewhere the
    // reference has spread ones (e.g. blown highlights), which is common. The
    // fix is at the source: refuse taps that sit too close together, and too
    // close to the 255 anchor.
    if (x <= 2 || x - lastX < MIN_TAP_SPACING || x > 255 - MIN_TAP_SPACING) continue;
    pts.push({ x, y });
    lastX = x;
  }
  pts.push({ x: 255, y: 255 });

  // Curve points must be strictly increasing in x, and non-decreasing in y —
  // a non-monotonic curve inverts tones and is rejected by Lightroom.
  const mono: CurvePoint[] = [];
  for (const p of pts) {
    const prev = mono[mono.length - 1];
    if (prev && p.x <= prev.x) {
      if (p.y > prev.y) prev.y = p.y;
      continue;
    }
    if (prev && p.y < prev.y) p.y = prev.y;
    mono.push(p);
  }
  if (mono.length < 2) return { points: [{ x: 0, y: 0 }, { x: 255, y: 255 }], x: [0, 255] };

  // Belt and braces: cap the slope of any interior segment. The final anchor is
  // left untouched so the curve always terminates at white.
  for (let i = 1; i < mono.length - 1; i++) {
    const prev = mono[i - 1];
    const dx = mono[i].x - prev.x;
    if (dx <= 0) continue;
    const maxY = prev.y + dx * MAX_CURVE_SLOPE;
    if (mono[i].y > maxY) mono[i].y = Math.round(maxY);
  }

  return { points: mono, x: mono.map((p) => p.x) };
}

/** Pull a curve toward identity — the restrained solution's tone move. */
const softenCurve = (c: CurvePoint[], pull: number): CurvePoint[] =>
  c.map((p) => ({ x: p.x, y: p.y + (p.x - p.y) * pull }));

/**
 * Describe a curve using the Basic sliders. Display only — see the header note.
 * Values are read off the curve's deviation from identity in the tonal band
 * each slider nominally governs.
 */
function describeCurve(curve: CurvePoint[]): Pick<
  Adjustments,
  'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
> {
  const at = (x: number): number => {
    let i = 0;
    while (i < curve.length - 2 && curve[i + 1].x < x) i++;
    const p0 = curve[i];
    const p1 = curve[i + 1] ?? curve[i];
    const t = p1.x === p0.x ? 0 : (x - p0.x) / (p1.x - p0.x);
    return p0.y + (p1.y - p0.y) * Math.max(0, Math.min(1, t));
  };
  const dev = (x: number): number => (at(x) - x) / 2.55; // -> roughly slider units
  // Contrast from the slope across the midtones rather than a single point.
  const slope = (at(180) - at(76)) / (180 - 76);
  return {
    contrast: Math.round((slope - 1) * 100),
    highlights: Math.round(dev(200) * 1.6),
    shadows: Math.round(dev(56) * 1.6),
    whites: Math.round(dev(240) * 1.6),
    blacks: Math.round(dev(16) * 1.6),
  };
}

// --- Solver -------------------------------------------------------------------

export interface SolveOptions {
  calibration?: Calibration;
}

interface Build {
  adj: Adjustments;
  state: State;
  notes: MatchNote[];
  /** 0..1 — fraction of the measured gap the clamped controls actually closed. */
  reachability: number;
  /** RMS OKLab a/b error across the luminance zones after the full solve. */
  colourResidual: number;
}

function solveOne(
  ref: PhotoAnalysis,
  mine: PhotoAnalysis,
  cal: Calibration,
  restrained: boolean,
  sharedCurveX: number[] | null,
): Build {
  const notes: MatchNote[] = [];
  let colourResidual = 0;
  const state = initialState(mine);
  const adj = identityAdjustments();
  const damp = restrained ? RESTRAINED_DAMP : 1;

  const refGlobal = ref.regions.global;
  const myGlobal = mine.regions.global;
  if (!refGlobal || !myGlobal) {
    return {
      adj,
      state,
      reachability: 0,
      colourResidual: 0,
      notes: [{ severity: 'caution', panel: 'Light', text: 'One of the photos could not be measured.' }],
    };
  }

  // ── 1. Exposure ────────────────────────────────────────────────────────────
  // Least-squares over the mid-range rather than the median alone. Exposure is
  // a single scale factor, so it should carry only the component COMMON to the
  // whole tonal range; fitting it to the median made it absorb shape as well,
  // and the curve then had to undo it at the top end, producing a violent
  // highlight boost. (Y = L^3, so a stop is 3 log2 units of L.)
  let logSum = 0;
  let logN = 0;
  for (const i of EXPOSURE_TAPS) {
    const r = refGlobal.percentiles[i];
    const m = myGlobal.percentiles[i];
    if (r > 0.02 && m > 0.02) {
      logSum += Math.log2(r / m);
      logN++;
    }
  }
  let exposure = logN > 0 ? 3 * (logSum / logN) : 0;
  exposure *= damp;
  if (restrained) exposure = Math.max(-RESTRAINED_MAX_EXPOSURE, Math.min(RESTRAINED_MAX_EXPOSURE, exposure));
  else exposure = Math.max(-3, Math.min(3, exposure));
  adj.exposure = exposure;
  applyExposure(state, exposure);

  // ── 2. Tone curve ──────────────────────────────────────────────────────────
  const fitted = fitCurve(state.percentiles, refGlobal.percentiles);
  let curve = fitted.points;
  if (restrained) curve = softenCurve(curve, RESTRAINED_CURVE_PULL);
  // Both solutions must share x positions so the strength slider can blend.
  if (sharedCurveX) {
    curve = sharedCurveX.map((x, i) => ({ x, y: curve[i]?.y ?? x }));
  }
  adj.curve = curve;
  applyCurve(state, curve);
  Object.assign(adj, describeCurve(curve));

  // ── 3. Saturation ──────────────────────────────────────────────────────────
  //
  // From here on, every stage applies to the running state ONLY WHAT THE
  // CLAMPED SLIDER CAN ACTUALLY DELIVER. Applying the requested move instead
  // would leave the state believing in a correction Lightroom cannot make, and
  // every later stage would then compute its residual against a fiction —
  // silently under-correcting masks and colour grading. It also means whatever
  // gap survives to the end of the pipeline is, by construction, the honest
  // unreachable remainder.
  //
  // Chroma scale and global cast are fitted JOINTLY, by least squares across
  // the three luminance zones — not sequentially off the frame mean.
  //
  // The model is: predicted_z = k·mine_z + d, for zone z, in OKLab a/b. Solving
  // for k and d together is a two-line closed form and is strictly better
  // conditioned than the old approach of scaling chroma to match the frame's
  // mean and then bolting on whatever offset was left over. That version fitted
  // both parameters to a single data point (the frame mean) and let the error
  // fall wherever it landed; this one minimises the error over every zone at
  // once, so a photo whose shadows and highlights disagree about the cast gets
  // a scale that suits both rather than one that suits neither.
  const zoneKeys: RegionKey[] = ['zone.shadow', 'zone.midtone', 'zone.highlight'];
  const fitPts = zoneKeys
    .map((k) => ({ m: state.regions.get(k), r: ref.regions[k] }))
    .filter((p): p is { m: Sample; r: RegionStats } => Boolean(p.m && p.r))
    .map((p) => ({ m: [p.m.a, p.m.b] as const, r: [p.r.ab.a, p.r.ab.b] as const, w: Math.max(1e-4, p.r.coverage) }));

  const myC = state.regions.get('global')?.C ?? myGlobal.C.mean;
  const fallbackRatio = myC > 1e-5 ? refGlobal.C.mean / myC : 1;

  let k = fallbackRatio;
  if (fitPts.length >= 2) {
    // Saturation scales the MAGNITUDE of (a,b); it cannot rotate hue. So k is
    // fitted on magnitudes, weighted across the zones.
    //
    // An earlier version fitted k by least squares on the vectors themselves —
    // minimising ||k·m_z + d − r_z||. That is the textbook joint fit, and it is
    // wrong for this control: when the two photographs' hues differ (here by
    // 52°), the covariance term goes negative and least squares returns a
    // NEGATIVE scale. It duly reported Saturation −52 for a reference twice as
    // colourful as the photo. Least squares was answering "what linear map best
    // relates these vectors", when the question is "how much more colour is
    // there" — a magnitude question, whose answer is always positive.
    const num = fitPts.reduce((s, p) => s + p.w * Math.hypot(p.r[0], p.r[1]), 0);
    const den = fitPts.reduce((s, p) => s + p.w * Math.hypot(p.m[0], p.m[1]), 0);
    if (den > 1e-9) k = num / den;
  }
  k = Math.max(0.25, Math.min(3, Number.isFinite(k) ? k : fallbackRatio));

  let wantedDelta = (k - 1) * damp; // in ratio units
  if (restrained) {
    wantedDelta = Math.max(RESTRAINED_CAPS.chromaDown, Math.min(RESTRAINED_CAPS.chromaUp, wantedDelta));
  }
  const satRatio = k;
  if (restrained) {
    // Vibrance protects already-saturated colours and skin, which is exactly
    // the restrained solution's intent.
    adj.vibrance = clampTo(wantedDelta * 100 * 0.7 * cal.vibranceGain, 100);
    adj.saturation = clampTo(wantedDelta * 100 * 0.3 * cal.saturationGain, 100);
  } else {
    adj.saturation = clampTo(wantedDelta * 100 * cal.saturationGain, 100);
  }
  const achievedDelta =
    adj.saturation / (100 * cal.saturationGain) + adj.vibrance / (100 * cal.vibranceGain);
  // Faithful pass only, for the same reason as the mask caps below: the
  // restrained pass clamps deliberately and would report its own restraint as
  // if it were a limit of the tool.
  if (!restrained && Math.abs(wantedDelta) - Math.abs(achievedDelta) > 0.08) {
    notes.push({
      severity: 'caution',
      panel: 'Colour',
      text: `The reference is ${satRatio.toFixed(1)}x as saturated as your photo — more than the Saturation slider can reach. It is set to its limit, and the remaining difference is left unmatched rather than forced through other controls.`,
    });
  }
  applyChromaScale(state, 1 + achievedDelta);

  // ── 4. Global colour cast (Colour Grading > Global) ────────────────────────
  //
  // The offset half of the joint fit above: d = r̄ − k·m̄, taken over the zones
  // rather than the frame mean, so Global carries the component COMMON to the
  // whole tonal range and the three wheels below carry only the deviations.
  // Because the fit is least-squares, those deviations sum to ~zero by
  // construction — which is exactly how the panel is meant to be used, and
  // stops Global and Midtones both pushing the same direction at once.
  const gs = state.regions.get('global')!;
  // The photo's own colourfulness sets the scale for what counts as a tint
  // rather than a repaint. Measured before the cast is applied.
  const ownChroma = Math.max(0.012, myGlobal.C.mean);
  let da: number;
  let db: number;
  if (fitPts.length >= 2) {
    const wsum = fitPts.reduce((s, p) => s + p.w, 0);
    const applied = 1 + achievedDelta; // the scale the sliders can actually deliver
    da = (fitPts.reduce((s, p) => s + p.w * (p.r[0] - applied * p.m[0]), 0) / wsum) * damp;
    db = (fitPts.reduce((s, p) => s + p.w * (p.r[1] - applied * p.m[1]), 0) / wsum) * damp;
  } else {
    da = (refGlobal.ab.a - gs.a) * damp;
    db = (refGlobal.ab.b - gs.b) * damp;
  }
  let castMag = Math.hypot(da, db);
  if (restrained) {
    const ceiling = ownChroma * RESTRAINED_CAPS.globalCastOfChroma;
    if (castMag > ceiling) {
      const k = ceiling / castMag;
      da *= k;
      db *= k;
      castMag = ceiling;
    }
  }
  if (castMag > 0.002) {
    const gradeSat = Math.min(100, (castMag / cal.colorGradeUnit) * 100);
    adj.grading.global = {
      hue: oklabDirectionToLightroomHue(da, db),
      sat: gradeSat,
      lum: 0,
    };
    // Reported as the manual alternative. The preset routes the move through
    // Colour Grading because Temp/Tint on a RAW are absolute Kelvin — writing
    // those into a preset would discard the photo's own as-shot white balance.
    adj.temp = (db / cal.tempUnit) * 100;
    adj.tint = (da / cal.tintUnit) * 100;
    notes.push({
      severity: 'info',
      panel: 'Colour',
      text:
        'The global colour cast is applied through Colour Grading > Global so it stays relative to your photo. ' +
        'The Temp/Tint values are the equivalent manual move — use one route or the other, not both.',
    });
    // Only the achievable fraction reaches the state (see stage 3).
    const achieved = (gradeSat / 100) * cal.colorGradeUnit;
    const scale = castMag > 1e-9 ? Math.min(1, achieved / castMag) : 0;
    applyColourOffset(state, da * scale, db * scale);
  }

  // ── 5. Colour Mixer, per band ──────────────────────────────────────────────
  const hsl = zeroHsl();
  let sparseBands = 0;
  for (let i = 0; i < HSL_BANDS.length; i++) {
    const band = HSL_BANDS[i];
    const r = ref.hslBands[i];
    const m = state.bands[i];
    const mOrig = mine.hslBands[i];
    if (!r || !m) continue;

    const refPresent = r.weight >= BAND_PRESENT;
    const myPresent = mOrig.weight >= BAND_PRESENT;

    if (myPresent && !refPresent) {
      // The reference simply does not contain this colour. We cannot know what
      // it "would have done" to it, so the only defensible move is toward
      // absence, scaled by how much of your frame it occupies.
      const pull = Math.min(1, mOrig.weight / 0.25);
      hsl[band.key].sat = clampTo(
        -60 * pull * damp * cal.hslSaturationGain,
        restrained ? RESTRAINED_CAPS.hslSat : 100,
      );
      sparseBands++;
      continue;
    }
    if (!myPresent || !refPresent) continue;

    // Saturation as a deviation from the global move already applied.
    const bandRatio = m.chroma > 1e-5 ? r.chroma / m.chroma : 1;
    const cap = restrained ? RESTRAINED_CAPS : null;
    hsl[band.key].sat = clampTo(
      (bandRatio - 1) * 100 * damp * cal.hslSaturationGain,
      cap ? cap.hslSat : 100,
    );
    // Luminance residual after exposure + curve.
    hsl[band.key].lum = clampTo((r.L - m.L) * cal.hslLuminanceGain * damp, cap ? cap.hslLum : 100);
    // Hue rotation within the band.
    const dh = circDelta(m.hue, r.hue);
    hsl[band.key].hue = clampTo(
      (dh / cal.hslHueDegreesAt100) * 100 * damp,
      cap ? cap.hslHue : 100,
    );
  }
  adj.hsl = hsl;
  applyMixer(state, hsl, cal);
  if (sparseBands > 0) {
    notes.push({
      severity: 'caution',
      panel: 'Colour Mixer',
      text: `${sparseBands} colour band${sparseBands > 1 ? 's are' : ' is'} present in your photo but absent from the reference. Those are desaturated toward the reference rather than matched, because there is no target to match to.`,
    });
  }

  // ── 6. Colour Grading, per zone ────────────────────────────────────────────
  const zoneMap: Array<[RegionKey, 'shadows' | 'midtones' | 'highlights']> = [
    ['zone.shadow', 'shadows'],
    ['zone.midtone', 'midtones'],
    ['zone.highlight', 'highlights'],
  ];
  const zoneMag: Record<string, number> = {};
  const zoneDev: { shadow: [number, number]; mid: [number, number]; high: [number, number] } = {
    shadow: [0, 0],
    mid: [0, 0],
    high: [0, 0],
  };
  const devSlot = { shadows: 'shadow', midtones: 'mid', highlights: 'high' } as const;
  for (const [regionKey, wheel] of zoneMap) {
    const r = ref.regions[regionKey];
    const m = state.regions.get(regionKey);
    if (!r || !m) continue;
    // A zone whose hue does not resolve has no colour to match — the hues in it
    // cancel out, and any wheel value would be invented.
    if (r.hue.strength < MIN_HUE_STRENGTH) {
      notes.push({
        severity: 'info',
        panel: 'Colour Grading',
        text: `${REGION_LABEL[regionKey]} in the reference have no coherent hue (resultant ${r.hue.strength.toFixed(2)}), so that wheel is left at zero rather than given an invented target.`,
      });
      continue;
    }
    const zda = (r.ab.a - m.a) * damp;
    const zdb = (r.ab.b - m.b) * damp;
    let mag = Math.hypot(zda, zdb);
    // Zone wheels stack on top of the global one, so their ceiling is tighter.
    if (restrained) mag = Math.min(mag, ownChroma * RESTRAINED_CAPS.zoneCastOfChroma);
    zoneMag[wheel] = mag;
    if (mag < 0.004) continue;
    const sat = Math.min(100, (mag / cal.colorGradeUnit) * 100);
    adj.grading[wheel] = {
      hue: oklabDirectionToLightroomHue(zda, zdb),
      sat,
      lum: 0,
    };
    // Record what the clamped wheel actually delivers, so it can be folded into
    // the state below rather than left for the masks to re-correct.
    const raw = Math.hypot(zda, zdb);
    const achievedMag = Math.min(mag, (sat / 100) * cal.colorGradeUnit);
    const scale = raw > 1e-9 ? achievedMag / raw : 0;
    zoneDev[devSlot[wheel]] = [zda * scale, zdb * scale];
  }
  applyZoneTints(state, zoneDev);
  // Balance leans toward whichever end carries the larger move.
  const sh = zoneMag.shadows ?? 0;
  const hi = zoneMag.highlights ?? 0;
  if (sh + hi > 1e-6) adj.grading.balance = Math.round(((hi - sh) / (hi + sh)) * 60 * damp);

  // ── 7. Masks ───────────────────────────────────────────────────────────────
  const maskable: Array<[RegionKey, MaskAdjustment['kind']]> = [
    ['scene.sky', 'sky'],
    ['subject', 'subject'],
    ['background', 'background'],
    ['people.skin', 'manual'],
    ['people.hair', 'manual'],
    ['people.clothing', 'manual'],
    ['scene.foliage', 'manual'],
    ['scene.water', 'manual'],
    ['scene.built', 'manual'],
    ['scene.ground', 'manual'],
  ];
  const masks: MaskAdjustment[] = [];
  const cappedMasks: Array<{ label: string; wanted: number; capped: number }> = [];
  for (const [regionKey, kind] of maskable) {
    const r = ref.regions[regionKey];
    const m = state.regions.get(regionKey);
    if (!r || !m) continue;

    const isSkin = regionKey === 'people.skin';
    const localDamp = damp * (restrained && isSkin ? SKIN_DAMP : 1);

    const expoRaw = m.L > 1e-4 ? 3 * Math.log2(r.L.mean / m.L) * localDamp : 0;
    const expoCap = restrained ? MASK_MAX_EXPOSURE.restrained : MASK_MAX_EXPOSURE.faithful;
    const expo = clampTo(expoRaw, expoCap);
    if (Math.abs(expoRaw) > expoCap + 0.15) {
      cappedMasks.push({ label: REGION_LABEL[regionKey], wanted: expoRaw, capped: expo });
    }
    const mda = (r.ab.a - m.a) * localDamp;
    const mdb = (r.ab.b - m.b) * localDamp;
    const satDelta =
      m.C > 1e-5 ? (r.C.mean / m.C - 1) * 100 * localDamp * cal.localSaturationGain : 0;

    const worthIt =
      Math.abs(expo) >= MASK_MIN_EXPOSURE ||
      Math.hypot(mda, mdb) >= MASK_MIN_COLOUR ||
      Math.abs(satDelta) >= MASK_MIN_SAT;
    if (!worthIt) continue;

    masks.push({
      region: regionKey,
      kind,
      label: REGION_LABEL[regionKey],
      exposure: expo,
      temp: (mdb / cal.localTempUnit) * 100,
      tint: (mda / cal.localTintUnit) * 100,
      saturation: satDelta,
      contrast: 0,
      // Describes the measured gap, not the capped move, so the rationale stays
      // true even where the move was held back.
      rationale:
        `After the global grade, ${REGION_LABEL[regionKey].toLowerCase()} still sits ` +
        `${expoRaw >= 0 ? 'darker' : 'brighter'} than the reference by ${Math.abs(expoRaw).toFixed(2)} stops` +
        (Math.hypot(mda, mdb) >= MASK_MIN_COLOUR ? ' and carries a different colour' : '') +
        '.',
    });
  }
  adj.masks = masks;
  // Faithful pass only. Both passes cap masks, but at different limits, so
  // emitting from both produced two notes about the same region quoting
  // different held-at values — which reads as the tool contradicting itself.
  // The faithful pass states the real ceiling; the restrained one is holding
  // back on purpose and has nothing separate to report.
  if (!restrained) {
    for (const c of cappedMasks) {
      notes.push({
        severity: 'caution',
        panel: 'Masks',
        text: `Matching ${c.label.toLowerCase()} exactly would need ${c.wanted >= 0 ? '+' : ''}${c.wanted.toFixed(2)} stops on that mask, which would rebuild the area rather than grade it. It is held at ${c.capped >= 0 ? '+' : ''}${c.capped.toFixed(2)} — the region will stay visibly different from the reference.`,
      });
    }
  }
  const manual = masks.filter((m) => m.kind === 'manual');
  if (manual.length > 0) {
    notes.push({
      severity: 'info',
      panel: 'Masks',
      text: `${manual.map((m) => m.label).join(', ')} ${manual.length > 1 ? 'need' : 'needs'} a mask you draw yourself — Lightroom can regenerate Subject, Sky and Background automatically, but not these.`,
    });
  }

  // ── 8. Effects and Detail ──────────────────────────────────────────────────
  if (textureComparable(ref.texture, mine.texture)) {
    const dGrain = ref.texture.grain - mine.texture.grain;
    if (dGrain > 0) {
      adj.grainAmount = Math.min(100, (dGrain / cal.grainUnit) * 100 * damp);
      // Lightroom's Size is roughly linear in grain period over its useful range.
      adj.grainSize = Math.min(100, Math.max(0, (ref.texture.grainSize - 1) * 25));
      adj.grainRoughness = 50;
    } else if (dGrain < 0) {
      // You cannot subtract grain with the Grain slider; that is what noise
      // reduction is for.
      adj.noiseReduction = Math.min(100, (-dGrain / cal.noiseReductionUnit) * 100 * damp);
    }
    const dAcut = ref.texture.acutance - mine.texture.acutance;
    adj.texture = Math.max(-100, Math.min(100, (dAcut / cal.textureUnit) * 100 * damp));
  } else {
    notes.push({
      severity: 'caution',
      panel: 'Effects',
      text:
        ref.texture.usable && mine.texture.usable
          ? 'Grain and sharpening were measured at different pixel scales, so they cannot be compared honestly. Those controls are left at zero.'
          : `Grain, texture and noise could not be measured: ${(!ref.texture.usable ? ref.texture.reason : mine.texture.reason) ?? 'unavailable'}`,
    });
  }

  if (ref.vignette.usable && mine.vignette.usable) {
    const dStops = ref.vignette.falloffStops - mine.vignette.falloffStops;
    adj.vignette = Math.max(-100, Math.min(100, (dStops / cal.vignetteStopsAt100) * 100 * damp));
  } else {
    notes.push({
      severity: 'info',
      panel: 'Effects',
      text: 'Corner falloff in one or both photos reads as scene content rather than a lens vignette, so the Vignetting slider is left alone.',
    });
  }

  // Clarity and Dehaze are deliberately not set: neither has a measurement in
  // this pipeline that is separable from global contrast, and inventing one
  // would mean moving a slider on no evidence.

  // ── Reachability ───────────────────────────────────────────────────────────
  const finalGlobal = state.regions.get('global')!;
  const reachability = reachabilityOf(ref, finalGlobal);

  // Colour residual: RMS OKLab a/b distance between the predicted grade and the
  // reference, across the luminance zones. This is the direct measure of how
  // well the grading replication actually landed — distinct from reachability,
  // which only looks at the frame as a whole and so cannot see a solution that
  // gets the average right while getting every zone wrong.
  {
    let acc = 0;
    let n = 0;
    for (const key of zoneKeys) {
      const m = state.regions.get(key);
      const r = ref.regions[key];
      if (!m || !r) continue;
      acc += (r.ab.a - m.a) ** 2 + (r.ab.b - m.b) ** 2;
      n++;
    }
    colourResidual = n > 0 ? Math.sqrt(acc / n) : 0;
  }

  // Only the faithful pass may report this. The restrained pass deliberately
  // stops short of the target, so its residual measures its own restraint, not
  // the limits of the two photographs — reporting it read as a far bleaker
  // verdict than the evidence supports.
  if (!restrained && reachability < 0.55) {
    const refHue = refGlobal.hue;
    const myHue = myGlobal.hue;
    const hueGap = Math.abs(circDelta(myHue.mean, refHue.mean));
    const hueIsReal = refHue.strength >= MIN_HUE_STRENGTH && myHue.strength >= MIN_HUE_STRENGTH;
    const parts: string[] = [];
    if (hueIsReal && hueGap > 40) {
      parts.push(
        `their dominant colours are ${hueGap.toFixed(0)}° apart on the hue wheel (${myHue.mean.toFixed(0)}° vs ${refHue.mean.toFixed(0)}°)`,
      );
    }
    if (Math.abs(refGlobal.C.mean - finalGlobal.C) > 0.02) {
      parts.push('the reference carries far more colour than your frame contains');
    }
    if (Math.abs(refGlobal.L.mean - finalGlobal.L) > 0.06) {
      parts.push('their tonal ranges do not overlap enough');
    }
    notes.unshift({
      severity: 'caution',
      panel: 'Overall',
      text:
        `These two photographs can only be brought about ${Math.round(reachability * 100)}% of the way together` +
        (parts.length ? `, because ${parts.join(', and ')}` : '') +
        '. That is a difference in what was photographed, not in how it was edited — no combination of Lightroom controls will close it. ' +
        'The values below are still the best available move, but expect the result to resemble the reference in mood rather than in colour.',
    });
  }

  return { adj: clampAdjustments(adj), state, notes, reachability, colourResidual };
}

/**
 * How hard the solution leans on its controls.
 *
 * Reachability answers "did the numbers converge"; this answers "will the
 * result look like a photograph". They can disagree sharply: a grade using
 * Saturation +100 alongside three Colour Grading wheels above 80 may close the
 * measured gap almost completely and still look obviously forced, because
 * matching statistics is not the same as matching craft. Counting the controls
 * pinned near their limits is the cheapest honest proxy for that.
 */
function extremeControls(a: Adjustments): string[] {
  const hit: string[] = [];
  const near = (v: number, limit = 85) => Math.abs(v) >= limit;
  if (near(a.saturation)) hit.push('Saturation');
  if (near(a.vibrance)) hit.push('Vibrance');
  if (near(a.temp)) hit.push('Temp');
  if (near(a.tint)) hit.push('Tint');
  for (const [name, w] of [
    ['Colour Grading Global', a.grading.global],
    ['Colour Grading Shadows', a.grading.shadows],
    ['Colour Grading Midtones', a.grading.midtones],
    ['Colour Grading Highlights', a.grading.highlights],
  ] as const) {
    if (w.sat >= 80) hit.push(name);
  }
  for (const band of HSL_BANDS) {
    if (near(a.hsl[band.key].sat, 80)) hit.push(`${band.label} saturation`);
  }
  return hit;
}

/** Confidence in the whole result, from baseline fidelity and comparability. */
function computeConfidence(ref: PhotoAnalysis, mine: PhotoAnalysis): number {
  const base = Math.min(BASELINE_FIDELITY[ref.baseline], BASELINE_FIDELITY[mine.baseline]);
  // How many regions could actually be compared?
  const refKeys = new Set(Object.keys(ref.regions));
  const shared = Object.keys(mine.regions).filter((k) => refKeys.has(k)).length;
  const coverage = Math.min(1, shared / 6);
  const textureOk = textureComparable(ref.texture, mine.texture) ? 1 : 0.9;
  return Math.max(0, Math.min(1, base * (0.65 + 0.35 * coverage) * textureOk));
}

/**
 * Solve a full match between two analysed photos.
 *
 * Returns both solutions plus the notes explaining every place the solver
 * declined to act. Blend them with `atStrength` from adjustments.ts.
 */
export function solveMatch(
  ref: PhotoAnalysis,
  mine: PhotoAnalysis,
  opts: SolveOptions = {},
): MatchSolution {
  const cal = opts.calibration ?? DEFAULT_CALIBRATION;

  // Faithful first so its curve x positions define the shared grid.
  const faithful = solveOne(ref, mine, cal, false, null);
  const curveX = faithful.adj.curve.map((p) => p.x);
  const restrained = solveOne(ref, mine, cal, true, curveX);

  // Notes are the same set from both passes; keep the faithful pass's copy and
  // add anything the restrained pass raised uniquely.
  const seen = new Set(faithful.notes.map((n) => n.text));
  const notes = [...faithful.notes, ...restrained.notes.filter((n) => !seen.has(n.text))];

  const extreme = extremeControls(faithful.adj);
  if (extreme.length >= 3) {
    notes.unshift({
      severity: 'caution',
      panel: 'Overall',
      text:
        `At full strength this grade pins ${extreme.length} controls at or near their limits (${extreme.slice(0, 4).join(', ')}${extreme.length > 4 ? ', …' : ''}). ` +
        'It will bring the measurements close, but a grade this hard tends to look forced rather than photographic. ' +
        'The restrained setting is the better starting point here — pull the strength slider back until it stops looking pushed.',
    });
  }

  if (ref.baseline === 'preview' || mine.baseline === 'preview') {
    notes.unshift({
      severity: 'caution',
      panel: 'Baseline',
      text: "One photo was read from a camera-embedded preview, which carries the camera's picture profile rather than Lightroom's baseline. Directions are right; magnitudes are approximate.",
    });
  }

  return {
    restrained: restrained.adj,
    faithful: faithful.adj,
    curveX,
    notes,
    basicSlidersAreDescriptive: true,
    confidence: computeConfidence(ref, mine),
    // Reported from the faithful pass: it is the ceiling on what is achievable,
    // whereas the restrained pass deliberately stops short of it.
    reachability: faithful.reachability,
    colourResidual: faithful.colourResidual,
  };
}
