import type { CurvePoint } from './adjustments';

// Lightroom's point curve, as Lightroom actually draws it.
//
// The ToneCurvePV2012 points are joined by a NATURAL CUBIC SPLINE (second
// derivative zero at both end points), evaluated on sRGB-encoded 0..255
// values, flat beyond the first and last points, and clipped to 0..255. This
// was checked against Lightroom Classic 15.5.1 exports of a gray ramp under two
// known curves (lr-data/lightroom-point-curves.json): the spline reproduces
// Lightroom to within 0.01 of a level, where straight lines between the points
// (what this app drew before) were 3.3 levels out on average and 6.9 at worst.
//
// A spline can overshoot between points — that is real Lightroom behaviour, so
// `evalSpline` keeps it. What the SOLVER must not do is hand Lightroom points
// whose spline dips or folds back, so fitted curves go through `keepMonotone`.

/** Second derivatives of the natural spline through `pts` (sorted by x). */
function secondDerivatives(xs: number[], ys: number[]): Float64Array {
  const n = xs.length;
  const m = new Float64Array(n);
  if (n < 3) return m;
  // Tridiagonal system for the interior second derivatives (Thomas algorithm).
  const sub = new Float64Array(n);
  const diag = new Float64Array(n);
  const sup = new Float64Array(n);
  const rhs = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    sub[i] = h0;
    diag[i] = 2 * (h0 + h1);
    sup[i] = h1;
    rhs[i] = 6 * ((ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0);
  }
  for (let i = 2; i < n - 1; i++) {
    const w = sub[i] / diag[i - 1];
    diag[i] -= w * sup[i - 1];
    rhs[i] -= w * rhs[i - 1];
  }
  m[n - 2] = rhs[n - 2] / diag[n - 2];
  for (let i = n - 3; i >= 1; i--) m[i] = (rhs[i] - sup[i] * m[i + 1]) / diag[i];
  return m;
}

/** Sorted, de-duplicated copy: Lightroom ignores a repeated x, keeping the first. */
function normalise(curve: CurvePoint[]): CurvePoint[] {
  const sorted = [...curve].sort((a, b) => a.x - b.x);
  const out: CurvePoint[] = [];
  for (const p of sorted) if (!out.length || p.x > out[out.length - 1].x) out.push(p);
  return out;
}

/** An evaluator for the curve, in 0..255 units in and out. */
export function splineOf(curve: CurvePoint[]): (x: number) => number {
  const pts = normalise(curve);
  if (pts.length === 0) return (x) => x;
  if (pts.length === 1) return () => pts[0].y;
  // Points on the diagonal draw the diagonal; return it exactly rather than
  // through spline arithmetic, so "no curve" never leaks float noise into a
  // solve that should find nothing to do.
  if (pts.every((p) => p.x === p.y) && pts[0].x === 0 && pts[pts.length - 1].x === 255) {
    return (x) => Math.min(255, Math.max(0, x));
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const m = secondDerivatives(xs, ys);
  const n = xs.length;
  return (x: number): number => {
    if (x <= xs[0]) return Math.min(255, Math.max(0, ys[0]));
    if (x >= xs[n - 1]) return Math.min(255, Math.max(0, ys[n - 1]));
    let i = 0;
    while (i < n - 2 && xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i];
    const a = (xs[i + 1] - x) / h;
    const b = (x - xs[i]) / h;
    const y = a * ys[i] + b * ys[i + 1] + ((a * a * a - a) * m[i] + (b * b * b - b) * m[i + 1]) * (h * h) / 6;
    return Math.min(255, Math.max(0, y));
  };
}

/** One-off evaluation. Prefer `splineOf` or `curveLut` in loops. */
export const evalSpline = (curve: CurvePoint[], x: number): number => splineOf(curve)(x);

/**
 * The curve as a lookup table over its encoded input, `size` entries spanning
 * 0..1, values 0..1. 4096 entries keep the LUT's own error far below a level
 * on 16-bit data; the WebGL preview uses 256 because its input is 8-bit.
 */
export function curveLut(curve: CurvePoint[], size = 4096): Float32Array {
  const f = splineOf(curve);
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) lut[i] = f((i / (size - 1)) * 255) / 255;
  return lut;
}

/** Read a 0..1 LUT at a 0..1 input, linearly between entries. */
export function readLut(lut: Float32Array, v: number): number {
  const at = Math.min(1, Math.max(0, v)) * (lut.length - 1);
  const i = Math.min(lut.length - 2, at | 0);
  const t = at - i;
  return lut[i] + (lut[i + 1] - lut[i]) * t;
}

/** Largest fall anywhere along the drawn curve, in levels. 0 = monotone. */
export function worstDip(curve: CurvePoint[]): number {
  const f = splineOf(curve);
  let peak = -Infinity;
  let worst = 0;
  for (let x = 0; x <= 255; x += 0.5) {
    const y = f(x);
    if (y > peak) peak = y;
    else worst = Math.max(worst, peak - y);
  }
  return worst;
}

/**
 * Relax a fitted curve until the spline Lightroom will draw through it never
 * falls. Histogram matching produces monotone POINTS, but a natural spline
 * through monotone points can still dip between them where the slope changes
 * sharply (a steep run beside a flat one) — and a falling tone curve inverts
 * tones, which reads as solarisation. Each pass pulls every interior point a
 * little towards the straight line through its neighbours, which reduces the
 * curvature that causes the dip while keeping the endpoints exactly where they
 * were. Usually zero or one or two passes.
 */
export function keepMonotone(curve: CurvePoint[], tolerance = 0.25): CurvePoint[] {
  let pts = normalise(curve).map((p) => ({ ...p }));
  for (let pass = 0; pass < 40 && worstDip(pts) > tolerance; pass++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      const a = pts[i - 1];
      const b = pts[i + 1];
      const line = a.y + ((b.y - a.y) * (p.x - a.x)) / (b.x - a.x);
      return { x: p.x, y: p.y + (line - p.y) * 0.25 };
    });
  }
  return pts;
}
