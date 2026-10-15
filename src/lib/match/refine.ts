import { clampAdjustments, identityAdjustments, type Adjustments } from './adjustments';
import type { Calibration } from './calibration';
import { keepMonotone } from './curve';
import type { LrTables } from './lr-model';
import { closeness, encodedLevel, simulate, targetFromAnalysis, type Closeness, type Measured, type SimTarget } from './simulate';
import type { MatchSolution } from './solve';
import { decodeSample, type DecodedSample } from './stats-core';
import { HSL_BANDS, type PhotoAnalysis, type RegionKey } from './types';

// Closing the loop: render the solver's answer through the Lightroom model,
// see where it actually lands, and correct it.
//
// The solver (solve.ts) still decides WHAT to do — which controls, in which
// direction, what to leave alone and why. Refinement only corrects HOW MUCH,
// and only on controls the solver already turned on, so its judgement (no
// invented hue on an unresolved zone, skin held back, bands the reference
// lacks toned down rather than matched) survives intact.
//
// Each control is corrected against the measurement it mainly drives, in
// small groups whose sensitivities are found by trying a little of each move
// on a thinned sample (a finite-difference Jacobian), then solved by damped
// least squares. Groups interact — a curve changes chroma, a mixer band moves
// a zone's colour — so the whole thing iterates, re-simulating in full each
// time, and a step that makes the result worse is taken back.

const ZONES: RegionKey[] = ['zone.shadow', 'zone.midtone', 'zone.highlight'];
const ITERATIONS = 8;
const JACOBIAN_STRIDE = 3;
/** How solve.ts's low-reachability note begins. */
const SHORT_NOTE = 'These two will only get about';
/** Furthest the curve's black end may lift (or its white end drop), in levels. */
const MAX_FADE = 60;

/**
 * The prior: among answers that fit about equally well, prefer the smaller
 * move. Statistics can't tell a grade from a scene — with the reference framed
 * differently, unregularised refinement moved midtones 40-60 levels and pinned
 * Saturation at −88 to chase content, where the true grade had moved midtones
 * under 10. Real presets are made of moderate moves, so every control pays for
 * its distance from zero, and the curve for its distance from the diagonal.
 * The strength was tuned on scripts/match-bench.ts across both identical and
 * differently framed references (see replica/round-6/diff.md).
 */
const PRIOR = Number(
  // An override for the benchmark only; the browser has no `process`.
  (typeof process !== 'undefined' ? process.env?.MATCH_PRIOR : undefined) ?? 1,
);
/** Curve deviation that counts as one full "big move", in levels. */
const CURVE_SCALE = 64;

interface Knob {
  get(a: Adjustments): number;
  set(a: Adjustments, v: number): void;
  lo: number;
  hi: number;
  /** Finite-difference step. */
  delta: number;
  /** What counts as a big move for this control, for the prior. Sliders 100. */
  scale?: number;
}

interface Group {
  knobs: Knob[];
  residual(sim: Measured): number[];
}

const field = (path: (a: Adjustments) => Record<string, number>, key: string, lo: number, hi: number, delta: number): Knob => ({
  get: (a) => path(a)[key],
  set: (a, v) => { path(a)[key] = Math.min(hi, Math.max(lo, v)); },
  lo, hi, delta,
});

/** A Colour Grading wheel as two cartesian knobs, so hue and strength move
 *  together smoothly instead of hue swinging wildly near zero strength. */
function wheelKnobs(wheel: 'global' | 'shadows' | 'midtones' | 'highlights'): Knob[] {
  const xy = (a: Adjustments) => {
    const w = a.grading[wheel];
    const r = (w.hue * Math.PI) / 180;
    return [w.sat * Math.cos(r), w.sat * Math.sin(r)];
  };
  const put = (a: Adjustments, x: number, y: number) => {
    const sat = Math.min(100, Math.hypot(x, y));
    const w = a.grading[wheel];
    let hue = (Math.atan2(y, x) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    a.grading[wheel] = { ...w, hue: sat > 0.5 ? hue : w.hue, sat };
  };
  return [
    { get: (a) => xy(a)[0], set: (a, v) => put(a, v, xy(a)[1]), lo: -100, hi: 100, delta: 4 },
    { get: (a) => xy(a)[1], set: (a, v) => put(a, xy(a)[0], v), lo: -100, hi: 100, delta: 4 },
  ];
}

const circDelta = (from: number, to: number): number => ((to - from) % 360 + 540) % 360 - 180;

function groupsFor(adj: Adjustments, target: SimTarget, restrained: boolean): Group[] {
  const groups: Group[] = [];
  const zoneW = ZONES.map((z) => target.zones[z]?.coverage ?? 0);
  const wsum = zoneW.reduce((s, w) => s + w, 0) || 1;
  const meanGap = (sim: Measured): [number, number] => {
    let da = 0;
    let db = 0;
    ZONES.forEach((z, i) => {
      const t = target.zones[z];
      const s = sim.regions[z];
      if (!t || !s) return;
      da += (zoneW[i] / wsum) * (t.a - s.ab.a);
      db += (zoneW[i] / wsum) * (t.b - s.ab.b);
    });
    return [da, db];
  };

  // ── Exposure: the tone's overall level ─────────────────────────────────
  // The curve also corrects tone point by point; Exposure carries the common
  // part, and the prior decides how the move is shared between them.
  groups.push({
    knobs: [{ get: (a) => a.exposure, set: (a, v) => { a.exposure = Math.min(5, Math.max(-5, v)); }, lo: -5, hi: 5, delta: 0.1, scale: 1 }],
    residual: (sim) => {
      const sp = sim.regions.global?.percentiles ?? [];
      let gap = 0;
      let n = 0;
      for (let i = 2; i <= 18 && i < sp.length; i++) {
        gap += encodedLevel(target.percentiles[i]) - encodedLevel(sp[i]);
        n++;
      }
      return [n ? gap / n / 50 : 0];
    },
  });

  // ── Overall colour: chroma level and the Global wheel ────────────────────
  const colour: Knob[] = [];
  if (restrained && (adj.vibrance !== 0 || adj.saturation !== 0)) {
    // The restrained solution moves Vibrance and Saturation as a pair; keep
    // their proportion and correct the pair's size.
    const share = adj.vibrance / (Math.abs(adj.vibrance) + Math.abs(adj.saturation) || 1);
    colour.push({
      get: (a) => a.vibrance + a.saturation,
      set: (a, v) => {
        a.vibrance = Math.min(100, Math.max(-100, v * share));
        a.saturation = Math.min(100, Math.max(-100, v * (1 - share)));
      },
      lo: -200, hi: 200, delta: 6, scale: 100,
    });
  } else {
    colour.push(field((a) => a as unknown as Record<string, number>, 'saturation', -100, 100, 6));
  }
  const globalOn = adj.grading.global.sat > 0;
  if (globalOn) colour.push(...wheelKnobs('global'));
  groups.push({
    knobs: colour,
    residual: (sim) => {
      let tC = 0;
      let sC = 0;
      ZONES.forEach((z, i) => {
        const t = target.zones[z];
        const s = sim.regions[z];
        if (!t || !s) return;
        tC += zoneW[i] * t.C;
        sC += zoneW[i] * s.C.mean;
      });
      const out = [sC > 1e-6 ? tC / sC - 1 : 0];
      if (globalOn) out.push(...meanGap(sim).map((v) => v * 10));
      return out;
    },
  });

  // ── Zone wheels: each zone's colour, apart from what Global carries ──────
  const zoneWheel = { 'zone.shadow': 'shadows', 'zone.midtone': 'midtones', 'zone.highlight': 'highlights' } as const;
  const onZones = ZONES.filter((z) => adj.grading[zoneWheel[z as keyof typeof zoneWheel]].sat > 0 && target.zones[z]);
  if (onZones.length) {
    groups.push({
      knobs: onZones.flatMap((z) => wheelKnobs(zoneWheel[z as keyof typeof zoneWheel])),
      residual: (sim) => {
        const [ma, mb] = globalOn ? meanGap(sim) : [0, 0];
        return onZones.flatMap((z) => {
          const t = target.zones[z]!;
          const s = sim.regions[z];
          if (!s) return [0, 0];
          return [(t.a - s.ab.a - ma) * 10, (t.b - s.ab.b - mb) * 10];
        });
      },
    });
  }

  // ── Colour Mixer, band by band ───────────────────────────────────────────
  HSL_BANDS.forEach((band, i) => {
    const v = adj.hsl[band.key];
    const t = target.bands[i];
    if (!t || t.weight < 0.02) return;
    const knobs: Knob[] = [];
    const kinds: Array<'sat' | 'lum' | 'hue'> = [];
    for (const kind of ['sat', 'lum', 'hue'] as const) {
      if (v[kind] === 0) continue;
      kinds.push(kind);
      knobs.push(field((a) => a.hsl[band.key] as unknown as Record<string, number>, kind, -100, 100, 8));
    }
    if (!knobs.length) return;
    groups.push({
      knobs,
      residual: (sim) => {
        const s = sim.hslBands[i];
        if (!s || s.weight < 1e-4) return kinds.map(() => 0);
        return kinds.map((k) =>
          k === 'sat' ? (s.chroma > 1e-6 ? t.chroma / s.chroma - 1 : 0)
          : k === 'lum' ? (t.L - s.L) * 5
          : circDelta(s.hue, t.hue) / 50,
        );
      },
    });
  });

  // ── Masks, region by region ──────────────────────────────────────────────
  for (const m of adj.masks) {
    const t = target.regions[m.region];
    if (!t) continue;
    const idx = adj.masks.indexOf(m);
    const knobs: Knob[] = [
      { get: (a) => a.masks[idx].exposure, set: (a, v) => { a.masks[idx].exposure = Math.min(4, Math.max(-4, v)); }, lo: -4, hi: 4, delta: 0.15, scale: 1.5 },
      { get: (a) => a.masks[idx].temp, set: (a, v) => { a.masks[idx].temp = Math.min(100, Math.max(-100, v)); }, lo: -100, hi: 100, delta: 8 },
      { get: (a) => a.masks[idx].tint, set: (a, v) => { a.masks[idx].tint = Math.min(100, Math.max(-100, v)); }, lo: -100, hi: 100, delta: 8 },
      { get: (a) => a.masks[idx].saturation, set: (a, v) => { a.masks[idx].saturation = Math.min(100, Math.max(-100, v)); }, lo: -100, hi: 100, delta: 8 },
    ];
    groups.push({
      knobs,
      residual: (sim) => {
        const s = sim.regions[m.region];
        if (!s) return [0, 0, 0, 0];
        return [(t.L - s.L.mean) * 5, (t.b - s.ab.b) * 10, (t.a - s.ab.a) * 10, s.C.mean > 1e-6 ? t.C / s.C.mean - 1 : 0];
      },
    });
  }
  return groups;
}

/** Solve (SᵀS + λI) x = Sᵀr for a small dense system. */
function leastSquares(S: number[][], r: number[]): number[] {
  const n = S[0]?.length ?? 0;
  const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => S.reduce((s, row) => s + row[i] * row[j], 0)));
  const b = Array.from({ length: n }, (_, i) => S.reduce((s, row, k) => s + row[i] * r[k], 0));
  const trace = A.reduce((s, row, i) => s + row[i], 0);
  const lambda = Math.max(1e-12, (trace / Math.max(1, n)) * 1e-3);
  for (let i = 0; i < n; i++) A[i][i] += lambda;
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    [A[c], A[p]] = [A[p], A[c]];
    [b[c], b[p]] = [b[p], b[c]];
    if (Math.abs(A[c][c]) < 1e-15) continue;
    for (let i = c + 1; i < n; i++) {
      const f = A[i][c] / A[c][c];
      for (let j = c; j < n; j++) A[i][j] -= f * A[c][j];
      b[i] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(A[i][i]) < 1e-15) continue;
    x[i] = (b[i] - A[i].slice(i + 1).reduce((s, a, k) => s + a * x[i + 1 + k], 0)) / A[i][i];
  }
  return x;
}

const copy = (a: Adjustments): Adjustments => JSON.parse(JSON.stringify(a)) as Adjustments;

/** Fractional percentile index (0..20) at which the pre-curve encoded level
 *  equals `x`. */
function quantileAt(pre: number[], x: number): number {
  if (x <= pre[0]) return 0;
  for (let i = 1; i < pre.length; i++) {
    if (x <= pre[i]) return i - 1 + (x - pre[i - 1]) / Math.max(1e-9, pre[i] - pre[i - 1]);
  }
  return pre.length - 1;
}
const at = (p: number[], q: number) => {
  const i = Math.min(p.length - 2, Math.max(0, Math.floor(q)));
  return p[i] + (p[i + 1] - p[i]) * (q - i);
};

/** One overall score, lower is better: colour by zone, tone along the
 *  histogram, and every masked region. */
/** How big a grade is, in "big moves": the prior's side of the score. */
function size(a: Adjustments, groups: Group[]): number {
  let sum = 0;
  for (const g of groups) for (const k of g.knobs) sum += (k.get(a) / (k.scale ?? 100)) ** 2;
  for (const p of a.curve) sum += ((p.y - p.x) / CURVE_SCALE) ** 2;
  return sum;
}

function score(c: Closeness): number {
  const regions = Object.values(c.regions);
  const reg = regions.length ? regions.reduce((s, v) => s + (v ?? 0), 0) / regions.length : 0;
  return c.deltaE + 0.25 * c.toneLevels + 0.5 * reg;
}

export interface RefineResult {
  adj: Adjustments;
  before: Closeness;
  after: Closeness;
  iterations: number;
  /** Fit plus prior, lower is better — comparable between runs on one target. */
  total: number;
}

/**
 * Correct `adj` until the simulated photo lands on `target`, or stops
 * improving. `mine` supplies the pre-grade tone the curve points sit on.
 */
export function refine(
  initial: Adjustments,
  target: SimTarget,
  mine: PhotoAnalysis,
  sample: DecodedSample,
  tables: LrTables,
  opts: { restrained?: boolean; cal?: Calibration } = {},
): RefineResult {
  const cal = opts.cal;
  let adj = copy(initial);
  const groups = groupsFor(adj, target, Boolean(opts.restrained));
  const minePct = mine.regions.global?.percentiles ?? [];

  const run = (a: Adjustments, stride = 1) => simulate(a, sample, tables, cal, stride);
  let sim = run(adj);
  const before = closeness(sim, target);
  const total = (c: Closeness, a: Adjustments) => score(c) + PRIOR * 2 * size(a, groups);
  let best = { adj: copy(adj), sim, s: total(before, adj) };
  let damping = 0.8;
  let jacobians: number[][][] = [];
  let iterations = 0;

  for (let it = 0; it < ITERATIONS; it++) {
    iterations = it + 1;
    // Sensitivities, at the start and again halfway, on a thinned sample.
    if (it === 0 || it === Math.floor(ITERATIONS / 2)) {
      const base = run(adj, JACOBIAN_STRIDE);
      jacobians = groups.map((g) => {
        const r0 = g.residual(base);
        const cols = g.knobs.map((k) => {
          const probe = copy(adj);
          const v = k.get(probe);
          const step = v + k.delta <= k.hi ? k.delta : -k.delta;
          k.set(probe, v + step);
          const r1 = g.residual(run(probe, JACOBIAN_STRIDE));
          return r0.map((x, i) => (x - r1[i]) / step);
        });
        return r0.map((_, i) => cols.map((c) => c[i]));
      });
    }

    const next = copy(adj);

    // Tone: move each interior curve point by the gap where its input lands.
    const sp = sim.regions.global?.percentiles;
    if (sp && minePct.length === sp.length && target.percentiles.length === sp.length) {
      const gain = Math.pow(2, adj.exposure / 3);
      const pre = minePct.map((L) => encodedLevel(L * gain));
      const curve = next.curve.map((p, i, all) => {
        // The end points move too — a lifted black or a held-down white is
        // half of most film looks — but read off the 2.5% and 97.5% points
        // rather than the extremes, which are single stray pixels, and only
        // as far as a fade or a soft white reasonably goes.
        if (i === 0 || i === all.length - 1) {
          if (p.x !== 0 && p.x !== 255) return p;
          const q = i === 0 ? 0.5 : sp.length - 1.5;
          const err = encodedLevel(at(target.percentiles, q)) - encodedLevel(at(sp, q));
          const y = p.y + damping * err;
          return { x: p.x, y: i === 0 ? Math.min(MAX_FADE, Math.max(0, y)) : Math.min(255, Math.max(255 - MAX_FADE, y)) };
        }
        const q = quantileAt(pre, p.x);
        const err = encodedLevel(at(target.percentiles, q)) - encodedLevel(at(sp, q));
        // Fit and prior together: the y that balances the gap against the
        // point's distance from the diagonal.
        const k2 = PRIOR * 0.15;
        const want = (p.y + err + k2 * p.x) / (1 + k2);
        return { x: p.x, y: Math.min(255, Math.max(0, p.y + damping * (want - p.y))) };
      });
      for (let i = 1; i < curve.length; i++) if (curve[i].y < curve[i - 1].y) curve[i].y = curve[i - 1].y;
      next.curve = keepMonotone(curve);
    }

    // Colour: each group's least-squares step from its own sensitivities.
    groups.forEach((g, gi) => {
      const S = jacobians[gi];
      if (!S?.length) return;
      const r = g.residual(sim);
      // Prior rows: each knob's value pulled toward zero, in its own scale.
      const mu = Math.sqrt(PRIOR * 0.05);
      const Sp = [...S, ...g.knobs.map((_, j) => g.knobs.map((__, k) => (k === j ? mu / (g.knobs[j].scale ?? 100) : 0)))];
      const rp = [...r, ...g.knobs.map((k) => (-mu * k.get(next)) / (k.scale ?? 100))];
      const dx = leastSquares(Sp, rp);
      g.knobs.forEach((k, j) => {
        const step = Math.max(-40, Math.min(40, damping * dx[j]));
        if (Number.isFinite(step)) k.set(next, k.get(next) + step);
      });
    });

    const nextSim = run(next);
    const s = total(closeness(nextSim, target), next);
    if (s < best.s - 1e-4) {
      adj = next;
      sim = nextSim;
      best = { adj: copy(next), sim: nextSim, s };
      damping = Math.min(0.9, damping * 1.1);
    } else {
      // Worse: take the step back and try a smaller one.
      damping *= 0.5;
      if (damping < 0.1) break;
    }
  }

  const finalAdj = clampAdjustments(best.adj);
  // Curve y values round in clampAdjustments; re-measure what will ship.
  const after = closeness(run(finalAdj), target);
  // Never hand back something the model says is worse than what came in.
  const t0 = total(before, initial);
  const t1 = total(after, finalAdj);
  if (t1 > t0) return { adj: clampAdjustments(initial), before, after: before, iterations, total: t0 };
  return { adj: finalAdj, before, after, iterations, total: t1 };
}

/**
 * Refine both solutions of a match and record how close each lands, all
 * simulated on `mine`'s own pixels. A photo without a pixel sample (an
 * analysis cached before round 6) comes back unchanged.
 */
export function refineSolution(
  solution: MatchSolution,
  reference: PhotoAnalysis,
  mine: PhotoAnalysis,
  tables: LrTables,
  cal?: Calibration,
): MatchSolution {
  if (!mine.sample) return solution;
  const sample = decodeSample(mine.sample);
  const target = targetFromAnalysis(reference);
  // The faithful pass starts from the solver's full-strength answer, and also
  // from the restrained one: when the full answer's big moves are mostly
  // chasing content, the prior pulls them back, and the nearer, smaller
  // answer is the better starting point. Whichever lands better is kept —
  // otherwise "Full" could land further from the reference than the middle.
  const fromFull = refine(solution.faithful, target, mine, sample, tables, { cal });
  const fromRestrained = refine(solution.restrained, target, mine, sample, tables, { cal });
  const faithful = fromRestrained.total < fromFull.total ? { ...fromRestrained, before: fromFull.before } : fromFull;
  const restrained = solution.restrainedIntent
    ? refine(solution.restrained, solution.restrainedIntent, mine, sample, tables, { restrained: true, cal })
    : null;
  const restrainedAdj = restrained?.adj ?? solution.restrained;
  const measure = (a: Adjustments) => closeness(simulate(a, sample, tables, cal), target);
  const untouched = measure(identityAdjustments(solution.curveX));

  // The solver's reachability came from region averages; the simulation is
  // the better witness, so it replaces it — and the "only gets so far" note
  // is corrected to match, or dropped when it no longer applies.
  const reachability = untouched.distance > 0.05 ? Math.max(0, Math.min(1, 1 - faithful.after.distance / untouched.distance)) : 1;
  const notes = solution.notes
    .map((n) => (n.text.startsWith(SHORT_NOTE) ? { ...n, text: n.text.replace(/about \d+%/, `about ${Math.round(reachability * 100)}%`) } : n))
    .filter((n) => !n.text.startsWith(SHORT_NOTE) || reachability < 0.55);
  return {
    ...solution,
    notes,
    reachability,
    faithful: faithful.adj,
    restrained: restrainedAdj,
    predicted: {
      untouched,
      restrained: measure(restrainedAdj),
      faithful: faithful.after,
      unrefined: faithful.before,
    },
  };
}
