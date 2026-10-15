import type { Adjustments } from './adjustments';
import { DEFAULT_CALIBRATION, type Calibration } from './calibration';
import { curveLut, readLut } from './curve';
import { HSL_BANDS } from './types';

// A model of what Lightroom does to a pixel, for the controls Style Match sets.
//
// Before round 6 the solver and the preview each carried their own idea of
// Lightroom: lightness-only curves, OKLab offsets for Colour Grading, linear
// gains for the Colour Mixer — all estimates (calibration.ts said so). This
// module replaces those ideas with measurements, so the solver can render its
// own answer and check it, and the preview shows what Lightroom will show.
//
// ── Where each stage comes from ─────────────────────────────────────────────
// Stage order and working spaces follow RAWmakase (MIT, github.com/pch/rawmakase),
// an open RAW developer fitted to Camera Raw 18.7 renders, which is the engine
// in Lightroom 9.x:
//
//   1. Exposure       a gain in linear light.
//   2. Point curve    hue-preserving RGB tone (the DNG SDK's RefBaselineRGBTone)
//                     in Melissa RGB — ProPhoto primaries, sRGB transfer — drawn
//                     as a natural spline (curve.ts). Checked here against
//                     Lightroom's own exports: 0.86 levels mean error on coloured
//                     ramps, where a lightness-only curve can't model the
//                     saturation an S-curve adds at all.
//   3. Colour Mixer,  measured tables over HSV of linear ProPhoto RGB: per band
//      Saturation,    and slider sign, the hue shift and log2 saturation/value
//      Vibrance       factors at ±100 on 36 hues × 6 saturations × 6 values
//                     (public/match-lr/color_mixer_chart.bin, vibrance_chart.bin).
//   4. Colour Grading per-channel gain curves in linear ProPhoto, shaped by
//                     Blending and Balance (public/match-lr/color_grade_curves.bin).
//   5. Masks          Style Match's own approximation, unchanged: Lightroom's
//                     local sliders are not in the measured set.
//
// What is still approximate, and said so where it matters: the input is the
// RENDERED photo, while Lightroom applies Exposure to scene-referred data
// before the profile's curve, so a big Exposure move compresses highlights a
// little more in Lightroom than here. A Lightroom zero-slider export as the
// baseline keeps every other stage exact to the tables.

/** sRGB-primaries linear → linear ProPhoto (D50, Bradford), and back. */
const RGB_TO_PRO = [
  0.529345, 0.330072, 0.140583,
  0.098374, 0.873462, 0.028164,
  0.016883, 0.117673, 0.865444,
];
const PRO_TO_RGB = [
  2.034075, -0.727334, -0.306742,
  -0.228813, 1.231731, -0.002918,
  -0.00857, -0.153286, 1.161856,
];
/** Rec. 709 luminance of a linear ProPhoto colour, via PRO_TO_RGB. */
const PRO_Y = [
  0.2126 * PRO_TO_RGB[0] + 0.7152 * PRO_TO_RGB[3] + 0.0722 * PRO_TO_RGB[6],
  0.2126 * PRO_TO_RGB[1] + 0.7152 * PRO_TO_RGB[4] + 0.0722 * PRO_TO_RGB[7],
  0.2126 * PRO_TO_RGB[2] + 0.7152 * PRO_TO_RGB[5] + 0.0722 * PRO_TO_RGB[8],
];

const srgbEncode = (y: number): number =>
  y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
const srgbDecode = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

// ─── Measured tables ───────────────────────────────────────────────────────

export interface LrTables {
  /** color_mixer_chart.bin: 52 tables × 3 channels × 1296 cells, i16 / 8000. */
  mixer: Int16Array;
  /** vibrance_chart.bin: 8 knots × 3 channels × 1296 cells, i16 / 8000. */
  vibrance: Int16Array;
  /** color_grade_curves.bin: f32. */
  grade: Float32Array;
}

const HUES = 36;
const SATS = 6;
const VALS = 6;
const CELLS = HUES * SATS * VALS;
const TABLE = 3 * CELLS;
const MIXER_TABLES = 52;
const SCALE = 1 / 8000;

/** Little-endian views; every platform this runs on is little-endian, which
 *  the length checks below would catch the day that stops being true. */
export function parseTables(mixer: ArrayBuffer, vibrance: ArrayBuffer, grade: ArrayBuffer): LrTables {
  const t = { mixer: new Int16Array(mixer), vibrance: new Int16Array(vibrance), grade: new Float32Array(grade) };
  if (t.mixer.length !== MIXER_TABLES * TABLE) throw new Error('Colour Mixer table has the wrong size.');
  if (t.vibrance.length !== 8 * TABLE) throw new Error('Vibrance table has the wrong size.');
  if (t.grade.length !== GRADE_LEN) throw new Error('Colour Grading table has the wrong size.');
  return t;
}

export const LR_TABLE_FILES = ['color_mixer_chart.bin', 'vibrance_chart.bin', 'color_grade_curves.bin'] as const;

// ─── Colour Mixer, Saturation, Vibrance ────────────────────────────────────

const LUMINANCE_DARKEN = 1.6;
const LUMINANCE_LIGHTEN = 0.79;
const GRAY_FROM = -0.5;
const VIBRANCE_KNOTS = [-1, -0.75, -0.5, -0.25, 0.25, 0.5, 0.75, 1];

/** Band Luminance is not linear in the slider; hue and saturation are. */
function strength(kind: number, s: number): number {
  const a = Math.min(1, Math.abs(s));
  return kind === 2 ? Math.pow(a, s < 0 ? LUMINANCE_DARKEN : LUMINANCE_LIGHTEN) : a;
}

/** Sum the active tables into one grid of (hue turns, log2 sat, log2 value). */
function sumGrid(t: LrTables, active: Array<[number, number]>): Float32Array {
  const out = new Float32Array(TABLE); // channel-major: [c * CELLS + cell]
  for (const [table, w] of active) {
    const base = table * TABLE;
    for (let c = 0; c < 3; c++) {
      const negSat = c === 1 && table % 2 === 0;
      for (let cell = 0; cell < CELLS; cell++) {
        const v = t.mixer[base + c * CELLS + cell] * SCALE;
        // Negative saturation sliders scale the FACTOR linearly, as Camera Raw does.
        out[c * CELLS + cell] += negSat ? Math.log2(Math.max(1e-3, 1 + w * (Math.pow(2, v) - 1))) : v * w;
      }
    }
  }
  return out;
}

function addVibrance(t: LrTables, grid: Float32Array, v: number): void {
  const x = Math.max(-1, Math.min(1, v));
  const i = VIBRANCE_KNOTS.findIndex((k) => k >= x);
  const knots: Array<[number, number]> = [];
  const below = i === -1 ? VIBRANCE_KNOTS.length - 1 : i - 1;
  const above = i === -1 ? -1 : i;
  if (below >= 0 && above >= 0 && VIBRANCE_KNOTS[below] < 0 && VIBRANCE_KNOTS[above] > 0) {
    // Between −25 and +25 the other end is no change at all.
    if (x < 0) knots.push([below, x / VIBRANCE_KNOTS[below]]);
    else knots.push([above, x / VIBRANCE_KNOTS[above]]);
  } else if (below >= 0 && above >= 0) {
    const tt = (x - VIBRANCE_KNOTS[below]) / (VIBRANCE_KNOTS[above] - VIBRANCE_KNOTS[below]);
    knots.push([below, 1 - tt], [above, tt]);
  } else if (below >= 0) knots.push([below, 1]);
  else if (above >= 0) knots.push([above, 1]);
  for (const [k, w] of knots) {
    if (w === 0) continue;
    const base = k * TABLE;
    for (let j = 0; j < TABLE; j++) grid[j] += w * t.vibrance[base + j] * SCALE;
  }
}

export interface MixerModel {
  /** Combined change grid, channel-major (3 × 1296). */
  delta: Float32Array;
  /** How far colours fade to their own luminance (Saturation below −50). */
  gray: number;
  /** The other sliders' grid, which sets the gray's brightness while fading. */
  graySource: Float32Array | null;
}

/** null when every mixer-stage slider is at zero. Sliders in Lightroom units. */
export function mixerModel(t: LrTables, adj: Pick<Adjustments, 'hsl' | 'saturation' | 'vibrance'>): MixerModel | null {
  const active: Array<[number, number]> = [];
  HSL_BANDS.forEach((band, b) => {
    const v = adj.hsl[band.key];
    [v.hue, v.sat, v.lum].forEach((slider, kind) => {
      const s = slider / 100;
      if (s !== 0) active.push([(b * 3 + kind) * 2 + (s > 0 ? 1 : 0), strength(kind, s)]);
    });
  });
  const sat = adj.saturation / 100;
  const vib = adj.vibrance / 100;
  const satForTables = Math.max(sat, GRAY_FROM);
  const chartVibrance = Math.abs(vib) > 0.5;
  for (const [i, s] of [[0, satForTables], [1, chartVibrance ? 0 : vib]] as const) {
    if (s !== 0) active.push([48 + i * 2 + (s > 0 ? 1 : 0), Math.min(2, Math.abs(s) * 2)]);
  }
  const gray = Math.max(0, Math.min(1, (GRAY_FROM - sat) / (1 + GRAY_FROM)));
  if (active.length === 0 && !chartVibrance) return null;

  const withVibrance = (g: Float32Array) => {
    if (chartVibrance) addVibrance(t, g, vib);
    return g;
  };
  const others = active.filter(([tbl]) => tbl !== 48 && tbl !== 49);
  return {
    delta: withVibrance(sumGrid(t, active)),
    gray,
    graySource: gray > 0 && (others.length > 0 || chartVibrance) ? withVibrance(sumGrid(t, others)) : null,
  };
}

/** Trilinear lookup of a grid at a ProPhoto HSV colour; hue wraps. */
function lookup(grid: Float32Array, h: number, s: number, v: number, out: Float64Array): void {
  const fh = (((h % 1) + 1) % 1) * HUES - 0.5;
  const fs = Math.min(SATS - 1, Math.max(0, Math.sqrt(Math.min(1, Math.max(0, s))) * SATS - 0.5));
  const fv = Math.min(VALS - 1, Math.max(0, Math.pow(Math.min(1, Math.max(0, v)), 0.45) * VALS - 0.5));
  const h0 = Math.floor(fh);
  const th = fh - h0;
  const s0 = Math.floor(fs);
  const v0 = Math.floor(fv);
  const ts = fs - s0;
  const tv = fv - v0;
  const s1 = Math.min(s0 + 1, SATS - 1);
  const v1 = Math.min(v0 + 1, VALS - 1);
  out[0] = out[1] = out[2] = 0;
  for (let dh = 0; dh < 2; dh++) {
    const hi = (((h0 + dh) % HUES) + HUES) % HUES;
    const wh = dh ? th : 1 - th;
    for (let ds = 0; ds < 2; ds++) {
      const si = ds ? s1 : s0;
      const ws = ds ? ts : 1 - ts;
      for (let dv = 0; dv < 2; dv++) {
        const vi = dv ? v1 : v0;
        const w = wh * ws * (dv ? tv : 1 - tv);
        if (w === 0) continue;
        const cell = (hi * SATS + si) * VALS + vi;
        out[0] += grid[cell] * w;
        out[1] += grid[CELLS + cell] * w;
        out[2] += grid[2 * CELLS + cell] * w;
      }
    }
  }
}

const scratch = new Float64Array(3);

/** A ProPhoto-linear colour through one mixer grid, in place. */
function throughGrid(grid: Float32Array, p: Float64Array): void {
  const r = Math.max(0, p[0]);
  const g = Math.max(0, p[1]);
  const b = Math.max(0, p[2]);
  const max = Math.max(r, g, b);
  if (max <= 1e-6) return;
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d >= 1e-9) {
    if (max === r) h = ((((g - b) / d) % 6) + 6) % 6 / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = d / max;
  lookup(grid, h, s, max, scratch);
  const hh = ((((h + scratch[0]) % 1) + 1) % 1) * 6;
  const ss = Math.min(1, Math.max(0, s * Math.pow(2, scratch[1])));
  const vv = max * Math.pow(2, scratch[2]);
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  const sector = Math.min(5, Math.floor(hh));
  const q =
    sector === 0 ? [c, x, 0] : sector === 1 ? [x, c, 0] : sector === 2 ? [0, c, x] :
    sector === 3 ? [0, x, c] : sector === 4 ? [x, 0, c] : [c, 0, x];
  p[0] = q[0] + m;
  p[1] = q[1] + m;
  p[2] = q[2] + m;
}

const proY = (p: ArrayLike<number>) => PRO_Y[0] * p[0] + PRO_Y[1] * p[1] + PRO_Y[2] * p[2];

function applyMixer(m: MixerModel, p: Float64Array): void {
  const r0 = p[0], g0 = p[1], b0 = p[2];
  throughGrid(m.delta, p);
  if (m.gray === 0) return;
  // Camera Raw's −100 keeps the luminance the colour has without Saturation.
  let y: number;
  if (m.graySource) {
    const src = new Float64Array([r0, g0, b0]);
    throughGrid(m.graySource, src);
    y = proY(src);
  } else y = proY([r0, g0, b0]);
  // Gray of luminance y is the same in every RGB space with a shared white.
  for (let c = 0; c < 3; c++) p[c] += m.gray * (y - p[c]);
}

// ─── Colour Grading ────────────────────────────────────────────────────────

const G_SAMPLES = 64;
const BLENDS = [0, 0.25, 0.5, 0.75, 1];
const BALANCES = [-1, -0.88, -0.75, -0.62, -0.5, -0.38, -0.25, -0.12, 0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];
const G_HUES = 12;
const G_SATS = [0, 0.25, 0.5, 0.75, 1];
const LUMINANCES = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
const TERMS = 3;
const SHAPED = 2;
const GRID_LEN = 3 * BLENDS.length * BALANCES.length * G_SAMPLES * SHAPED;
const GLOBAL = GRID_LEN;
const COEF = GLOBAL + G_SAMPLES * TERMS;
const COEF_LEN = 4 * G_HUES * (G_SATS.length - 1) * 3 * TERMS;
const LUM = COEF + COEF_LEN;
const GRADE_LEN = LUM + 4 * (LUMINANCES.length - 1) * G_SAMPLES;

/** Index of the bracketing pair and the fraction between them. */
function bracket(values: number[], v: number): [number, number] {
  const x = Math.min(values[values.length - 1], Math.max(values[0], v));
  let j = values.length - 2;
  for (let i = 0; i < values.length - 1; i++) if (x <= values[i + 1]) { j = i; break; }
  return [j, (x - values[j]) / (values[j + 1] - values[j])];
}

/** Region order in the table: Shadows, Midtones, Highlights, Global. */
type Region = 0 | 1 | 2 | 3;

function profiles(t: LrTables, region: Region, blending: number, balance: number): number[][] {
  const out = Array.from({ length: G_SAMPLES }, () => [0, 0, 0]);
  if (region === 3) {
    for (let k = 0; k < G_SAMPLES; k++) for (let tt = 0; tt < TERMS; tt++) out[k][tt] = t.grade[GLOBAL + k * TERMS + tt];
    return out;
  }
  const [i, u] = bracket(BLENDS, blending);
  const [j, v] = bracket(BALANCES, balance);
  const at = (b: number, a: number, k: number, tt: number) =>
    t.grade[(((region * BLENDS.length + b) * BALANCES.length + a) * G_SAMPLES + k) * SHAPED + tt];
  for (let k = 0; k < G_SAMPLES; k++) {
    for (let tt = 0; tt < SHAPED; tt++) {
      out[k][tt] =
        at(i, j, k, tt) * (1 - u) * (1 - v) + at(i + 1, j, k, tt) * u * (1 - v) +
        at(i, j + 1, k, tt) * (1 - u) * v + at(i + 1, j + 1, k, tt) * u * v;
    }
  }
  return out;
}

function coefficients(t: LrTables, region: Region, hue: number, sat: number): number[][] {
  const f = (((hue % 1) + 1) % 1) * G_HUES;
  const h0 = Math.floor(f) % G_HUES;
  const w = f - Math.floor(f);
  const [s, u] = bracket(G_SATS, sat);
  const at = (h: number, si: number, c: number, tt: number) =>
    si === 0 ? 0 : t.grade[COEF + (((region * G_HUES + h) * (G_SATS.length - 1) + si - 1) * 3 + c) * TERMS + tt];
  return [0, 1, 2].map((c) =>
    [0, 1, 2].map((tt) => {
      const hueAt = (si: number) => at(h0, si, c, tt) * (1 - w) + at((h0 + 1) % G_HUES, si, c, tt) * w;
      return hueAt(s) * (1 - u) + hueAt(s + 1) * u;
    }),
  );
}

function luminanceLog(t: LrTables, region: Region, amount: number): number[] {
  const [j, u] = bracket(LUMINANCES, amount);
  const table = (i: number): number[] => {
    if (i === 4) return new Array(G_SAMPLES).fill(0);
    const row = i < 4 ? i : i - 1;
    const at = LUM + (region * (LUMINANCES.length - 1) + row) * G_SAMPLES;
    return Array.from({ length: G_SAMPLES }, (_, k) => Math.log2(t.grade[at + k]));
  };
  const a = table(j);
  const b = table(j + 1);
  return a.map((x, k) => x * (1 - u) + b[k] * u);
}

function weightProfile(t: LrTables, region: Region, blending: number, balance: number): number[] {
  const p = profiles(t, region, blending, balance);
  const peak = p.reduce((m, r) => (Math.abs(r[0]) > Math.abs(m) ? r[0] : m), 0);
  return p.map((r) => (peak === 0 ? 0 : r[0] / peak));
}

const argmax = (v: number[]) => v.reduce((m, x, i) => (x > v[m] ? i : m), 0);

function sampleAt(table: number[], at: number): number {
  const a = Math.min(G_SAMPLES - 1, Math.max(0, at));
  const i = Math.min(G_SAMPLES - 2, Math.floor(a));
  const f = a - i;
  return table[i] * (1 - f) + table[i + 1] * f;
}

const encoded = (k: number) => k / (G_SAMPLES - 1);

/** Luminance gains at `amount`, keeping the strength it has at the default
 *  Blending/Balance where the region's weight is the same. */
function luminanceGains(t: LrTables, region: Region, amount: number, blending: number, balance: number): number[] {
  const log = luminanceLog(t, region, amount);
  const isDefault = Math.abs(blending - 0.5) < 1e-4 && Math.abs(balance) < 1e-4;
  if (region === 3 || isDefault) return log.map((x) => Math.pow(2, x));
  const w = weightProfile(t, region, blending, balance);
  const w0 = weightProfile(t, region, 0.5, 0);
  const peak = argmax(w);
  const peak0 = argmax(w0);
  const at = w.map((wk, k) => {
    const seg: number[] = [];
    if (k <= peak) for (let i = 0; i <= peak0; i++) seg.push(i);
    else for (let i = peak0; i < G_SAMPLES; i++) seg.push(i);
    let near = 0;
    for (let a = 1; a < seg.length; a++) if (Math.abs(w0[seg[a]] - wk) < Math.abs(w0[seg[near]] - wk)) near = a;
    for (const [a, b] of [[near - 1, near], [near, near + 1]]) {
      if (a >= 0 && b < seg.length) {
        const lo = w0[seg[a]];
        const hi = w0[seg[b]];
        if ((lo - wk) * (hi - wk) <= 0 && lo !== hi) {
          const f = (wk - lo) / (hi - lo);
          return seg[a] + f * (seg[b] - seg[a]);
        }
      }
    }
    return seg[near];
  });
  if (amount < 0) return at.map((x) => Math.pow(2, sampleAt(log, x)));
  const offset = log.map((x, k) => encoded(k) * (Math.pow(2, x / 2.2) - 1));
  return at.map((x, k) => (k === 0 ? Math.pow(2, log[0]) : Math.pow((encoded(k) + sampleAt(offset, x)) / encoded(k), 2.2)));
}

/** Per-channel gains (64 samples × 3, sample-major) over x^(1/2.2) of linear
 *  ProPhoto, or null when grading changes nothing. */
export function gradeGains(t: LrTables, g: Adjustments['grading']): Float32Array | null {
  const wheels = [g.shadows, g.midtones, g.highlights, g.global];
  if (wheels.every((w) => w.sat === 0 && w.lum === 0)) return null;
  const blending = g.blending / 100;
  const balance = g.balance / 100;
  const lum = new Array(G_SAMPLES).fill(1);
  const tint = Array.from({ length: G_SAMPLES }, () => [1, 1, 1]);
  wheels.forEach((w, ri) => {
    const region = ri as Region;
    if (w.lum !== 0) {
      const l = luminanceGains(t, region, w.lum / 100, blending, balance);
      for (let k = 0; k < G_SAMPLES; k++) lum[k] *= l[k];
    }
    if (w.sat !== 0) {
      const p = profiles(t, region, blending, balance);
      const c = coefficients(t, region, w.hue / 360, w.sat / 100);
      for (let k = 0; k < G_SAMPLES; k++) {
        for (let ch = 0; ch < 3; ch++) {
          tint[k][ch] *= 1 + p[k][0] * c[ch][0] + p[k][1] * c[ch][1] + p[k][2] * c[ch][2];
        }
      }
    }
  });
  // Luminance first, then the tint on its result.
  const out = new Float32Array(G_SAMPLES * 3);
  for (let k = 0; k < G_SAMPLES; k++) {
    const after = Math.pow(Math.min(1, Math.max(0, Math.pow(encoded(k), 2.2) * lum[k])), 1 / 2.2);
    for (let ch = 0; ch < 3; ch++) {
      out[k * 3 + ch] = lum[k] * Math.max(0, sampleAt(tint.map((r) => r[ch]), after * (G_SAMPLES - 1)));
    }
  }
  return out;
}

function applyGrade(gains: Float32Array, p: Float64Array): void {
  for (let c = 0; c < 3; c++) {
    const v = p[c];
    const at = Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2) * (G_SAMPLES - 1);
    const i = Math.min(G_SAMPLES - 2, Math.floor(at));
    const f = at - i;
    p[c] = v * (gains[i * 3 + c] * (1 - f) + gains[(i + 1) * 3 + c] * f);
  }
}

// ─── Point curve as RGB tone ───────────────────────────────────────────────

/** Hue-preserving tone: the largest and smallest channel go through the curve,
 *  the middle one keeps its place between them (DNG RefBaselineRGBTone). */
function rgbTone(lut: Float32Array, e: Float64Array): void {
  let hi = 0;
  let lo = 0;
  for (let c = 1; c < 3; c++) {
    if (e[c] > e[hi]) hi = c;
    if (e[c] < e[lo]) lo = c;
  }
  const H = e[hi];
  const L = e[lo];
  const fH = readLut(lut, H);
  if (H === L) {
    e[0] = e[1] = e[2] = fH;
    return;
  }
  const fL = readLut(lut, L);
  const mid = 3 - hi - lo;
  e[mid] = fL + ((fH - fL) * (e[mid] - L)) / (H - L);
  e[hi] = fH;
  e[lo] = fL;
}

// ─── The whole model ───────────────────────────────────────────────────────

export interface LrPrepared {
  gain: number;
  /** null when the curve is the identity. */
  curve: Float32Array | null;
  mixer: MixerModel | null;
  grade: Float32Array | null;
  /** Per mask channel: linear exposure gain, OKLab a/b offset, chroma factor. */
  masks: Array<{ gain: number; a: number; b: number; chroma: number }>;
}

/** Resolve slider values into the model's parameters. `maskChannels` names the
 *  region in each mask channel, in the order the caller supplies weights. */
export function prepareLr(
  adj: Adjustments,
  t: LrTables,
  maskChannels: string[] = [],
  cal: Calibration = DEFAULT_CALIBRATION,
): LrPrepared {
  const identity = adj.curve.every((p) => p.x === p.y);
  const byRegion = new Map(adj.masks.map((m) => [m.region as string, m]));
  return {
    gain: Math.pow(2, adj.exposure),
    curve: identity ? null : curveLut(adj.curve),
    mixer: mixerModel(t, adj),
    grade: gradeGains(t, adj.grading),
    masks: maskChannels.map((r) => {
      const m = byRegion.get(r);
      return {
        gain: Math.pow(2, m?.exposure ?? 0),
        a: ((m?.tint ?? 0) / 100) * cal.localTintUnit,
        b: ((m?.temp ?? 0) / 100) * cal.localTempUnit,
        chroma: Math.max(0, 1 + (m?.saturation ?? 0) / (100 * cal.localSaturationGain)),
      };
    }),
  };
}

const work = new Float64Array(3);

/**
 * One pixel through the model: linear sRGB in, linear sRGB out (clipped to
 * 0..1, as Lightroom's sRGB export clips). `maskWeights[i]` is the weight of
 * mask channel i at this pixel, 0..1.
 */
export function renderLinear(
  m: LrPrepared,
  r: number,
  g: number,
  b: number,
  maskWeights?: ArrayLike<number> | null,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  // 1. Exposure, then into ProPhoto.
  const R = r * m.gain, G = g * m.gain, B = b * m.gain;
  const p = work;
  p[0] = RGB_TO_PRO[0] * R + RGB_TO_PRO[1] * G + RGB_TO_PRO[2] * B;
  p[1] = RGB_TO_PRO[3] * R + RGB_TO_PRO[4] * G + RGB_TO_PRO[5] * B;
  p[2] = RGB_TO_PRO[6] * R + RGB_TO_PRO[7] * G + RGB_TO_PRO[8] * B;

  // 2. Point curve, in Melissa RGB.
  if (m.curve) {
    for (let c = 0; c < 3; c++) p[c] = srgbEncode(Math.min(1, Math.max(0, p[c])));
    rgbTone(m.curve, p);
    for (let c = 0; c < 3; c++) p[c] = srgbDecode(p[c]);
  }

  // 3–4. Mixer stage, then Colour Grading.
  if (m.mixer) applyMixer(m.mixer, p);
  if (m.grade) applyGrade(m.grade, p);

  let lr = PRO_TO_RGB[0] * p[0] + PRO_TO_RGB[1] * p[1] + PRO_TO_RGB[2] * p[2];
  let lg = PRO_TO_RGB[3] * p[0] + PRO_TO_RGB[4] * p[1] + PRO_TO_RGB[5] * p[2];
  let lb = PRO_TO_RGB[6] * p[0] + PRO_TO_RGB[7] * p[1] + PRO_TO_RGB[8] * p[2];

  // 5. Masks — Style Match's own approximation, in OKLab.
  if (maskWeights && m.masks.length) {
    for (let i = 0; i < m.masks.length; i++) {
      const w = maskWeights[i] ?? 0;
      if (w <= 0.002) continue;
      const mk = m.masks[i];
      const k = 1 + (mk.gain - 1) * w;
      lr *= k; lg *= k; lb *= k;
      if (mk.a === 0 && mk.b === 0 && mk.chroma === 1) continue;
      const lab = linearToOklab(Math.max(0, lr), Math.max(0, lg), Math.max(0, lb));
      const a = lab[1] + (lab[1] * mk.chroma + mk.a - lab[1]) * w;
      const bb = lab[2] + (lab[2] * mk.chroma + mk.b - lab[2]) * w;
      const back = oklabToLinear(lab[0], a, bb);
      lr = back[0]; lg = back[1]; lb = back[2];
    }
  }

  out[0] = Math.min(1, Math.max(0, lr));
  out[1] = Math.min(1, Math.max(0, lg));
  out[2] = Math.min(1, Math.max(0, lb));
  return out;
}

export function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export { srgbDecode, srgbEncode };
