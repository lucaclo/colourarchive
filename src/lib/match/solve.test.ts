/**
 * Tests for the match solver — the algorithm that turns a measured comparison
 * between two photographs into the Lightroom values that would make one carry
 * the other's grade.
 *
 * `solveMatch` is 1000-odd lines of a fixed-order pipeline, each stage reading
 * off a running "predicted state" so nothing double-corrects a cast a earlier
 * stage already spent. That architecture is the thing worth protecting, and it
 * is protected by invariants, not by pinning slider numbers: every constant in
 * calibration.ts is explicitly an estimate ("considered estimates... REPLACED
 * by real measurements"), so a test that hardcodes "Saturation should be 41.3"
 * would break the day someone plugs in a real measured calibration, for a
 * reason that has nothing to do with a regression. What survives that kind of
 * change is: a photo needs no correction to match itself; confidence and
 * reachability stay probabilities; a capped move gets a note; the two
 * solutions share a curve grid. Those are asserted here; exact numbers are
 * not.
 *
 * One property that is deliberately NOT tested: symmetry. `compareLooks` in
 * resemble.ts is symmetric by design; `solveMatch(ref, mine)` is not, and
 * should not be — it is a direction ("make mine look like ref"), not a
 * distance. If a change here starts asserting solveMatch(a, b) relates simply
 * to solveMatch(b, a), that is a sign the property has been misunderstood, not
 * a gap to fill in.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { identityAdjustments } from './adjustments.ts';
import { solveMatch, type MatchSolution } from './solve.ts';
import {
  HSL_BANDS,
  type BaselineMode,
  type HslBandStats,
  type PhotoAnalysis,
  type RegionKey,
  type RegionStats,
  type TextureStats,
  type VignetteStats,
} from './types.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */
//
// Built the same way resemble.test.ts builds a LookSignature: a small
// description of a "grade" (lightness, chroma, hue, and a tone curve shape)
// is expanded into a full, internally-consistent set of measurements, rather
// than each RegionStats being hand-typed field by field. `curve` is evaluated
// both at the zone's own tonal position (for L.mean) and across the full 0..1
// domain (for `percentiles`), so a photo's shadow/midtone/highlight regions
// and its whole-frame tone curve always agree with each other — the solver
// would otherwise be fitting a curve against a photo that disagrees with
// itself.

const percentilesFor = (curve: (v: number) => number): number[] =>
  Array.from({ length: 21 }, (_, i) => curve(i / 20));

interface RegionShape {
  L: number;
  C?: number;
  hue?: number;
  hueStrength?: number;
  curve?: (v: number) => number;
  coverage?: number;
  sampled?: number;
}

function region(key: RegionKey, shape: RegionShape): RegionStats {
  const C = shape.C ?? 0.05;
  const hue = shape.hue ?? 30;
  const rad = (hue * Math.PI) / 180;
  const curve = shape.curve ?? ((v: number) => v);
  return {
    key,
    coverage: shape.coverage ?? 1,
    sampled: shape.sampled ?? 50_000,
    L: { mean: shape.L, sd: 0.15 },
    C: { mean: C, sd: 0.015 },
    hue: { mean: hue, strength: shape.hueStrength ?? 0.6 },
    ab: { a: C * Math.cos(rad), b: C * Math.sin(rad) },
    percentiles: percentilesFor(curve),
  };
}

function texture(overrides: Partial<TextureStats> = {}): TextureStats {
  return {
    usable: true,
    blocked: 'none',
    normalised: true,
    nativeSize: { width: 4000, height: 3000 },
    grain: 0.01,
    grainSize: 1.5,
    acutance: 0.12,
    flatToEdge: 0.5,
    measuredAt: { width: 2400, height: 1800 },
    ...overrides,
  };
}

function vignette(overrides: Partial<VignetteStats> = {}): VignetteStats {
  return {
    falloffStops: -0.3,
    symmetry: 0.9,
    usable: true,
    ...overrides,
  };
}

function hslBand(key: HslBandStats['key'], overrides: Partial<HslBandStats> = {}): HslBandStats {
  const band = HSL_BANDS.find((b) => b.key === key)!;
  return {
    key,
    weight: 0.1,
    chroma: 0.05,
    L: 0.5,
    hue: band.H,
    ...overrides,
  };
}

function hslBands(
  overrides: Partial<Record<HslBandStats['key'], Partial<HslBandStats>>> = {},
): HslBandStats[] {
  return HSL_BANDS.map((b) => hslBand(b.key, overrides[b.key]));
}

interface PhotoShape {
  baseline?: BaselineMode;
  /** Tone curve shape shared by the whole-frame and per-zone measurements. */
  curve?: (v: number) => number;
  C?: number;
  hue?: number;
  hueStrength?: number;
  regionsOverride?: Partial<Record<RegionKey, RegionStats>>;
  /** Simulates a photo that could not be measured at all — the solver's
   *  degrade-gracefully path. */
  noRegions?: boolean;
  texture?: Partial<TextureStats>;
  vignette?: Partial<VignetteStats>;
  hslOverrides?: Partial<Record<HslBandStats['key'], Partial<HslBandStats>>>;
}

/** A whole PhotoAnalysis built from one description of a grade. Two calls with
 *  the same shape (even under different ids) produce measurement-identical,
 *  but distinct, fixtures — exactly what "solve a photo against itself" needs. */
function photo(id: string, shape: PhotoShape = {}): PhotoAnalysis {
  const curve = shape.curve ?? ((v: number) => v);
  const C = shape.C ?? 0.05;
  const hue = shape.hue ?? 30;
  const hueStrength = shape.hueStrength ?? 0.6;

  const regions: Partial<Record<RegionKey, RegionStats>> = shape.noRegions
    ? {}
    : {
        global: region('global', { L: curve(0.5), C, hue, hueStrength, curve, coverage: 1 }),
        'zone.shadow': region('zone.shadow', { L: curve(0.18), C, hue, hueStrength, curve, coverage: 0.3 }),
        'zone.midtone': region('zone.midtone', { L: curve(0.5), C, hue, hueStrength, curve, coverage: 0.4 }),
        'zone.highlight': region('zone.highlight', { L: curve(0.82), C, hue, hueStrength, curve, coverage: 0.3 }),
        ...shape.regionsOverride,
      };

  return {
    id,
    filename: `${id}.jpg`,
    baseline: shape.baseline ?? 'export',
    width: 4000,
    height: 3000,
    sampledAt: 2400,
    regions,
    texture: texture(shape.texture),
    vignette: vignette(shape.vignette),
    hslBands: hslBands(shape.hslOverrides),
    timings: {},
    warnings: [],
  };
}

/* ── Self-match ────────────────────────────────────────────────────────────── */

describe('solving a photo against itself', () => {
  it('asks for no change at all', () => {
    // Same measurements, distinct objects — as if the same photo were
    // analysed twice. If a photo needs no correction to match itself, the
    // solver must not invent one.
    const ref = photo('self-ref');
    const mine = photo('self-mine');
    const sol = solveMatch(ref, mine);

    // Every stage's contribution is provably zero here (exposure fits a log
    // ratio of identical percentiles; the curve fits identical percentiles
    // onto themselves; chroma scale and cast fit identical zones onto
    // themselves; the HSL bands and texture/vignette deltas are all zero) —
    // so both solutions should be, field for field, the identity adjustment
    // at the curve grid the solve settled on.
    const identity = identityAdjustments(sol.curveX);
    assert.deepEqual(sol.faithful, identity, 'faithful pass invented a move on a self-match');
    assert.deepEqual(sol.restrained, identity, 'restrained pass invented a move on a self-match');
  });

  it('reports a near-zero colour residual and full reachability', () => {
    const sol = solveMatch(photo('self-ref-2'), photo('self-mine-2'));
    assert.ok(sol.colourResidual < 1e-9, `colourResidual was ${sol.colourResidual}, expected ~0`);
    assert.equal(sol.reachability, 1);
  });

  it('raises no notes', () => {
    const sol = solveMatch(photo('self-ref-3'), photo('self-mine-3'));
    assert.deepEqual(sol.notes, []);
  });
});

/* ── basicSlidersAreDescriptive ───────────────────────────────────────────── */

describe('basicSlidersAreDescriptive', () => {
  it('is actually set to true on the result, not just true by type', () => {
    const sol = solveMatch(photo('bsad-ref'), photo('bsad-mine'));
    assert.equal(sol.basicSlidersAreDescriptive, true);
  });
});

/* ── Confidence and reachability ──────────────────────────────────────────── */

describe('confidence and reachability', () => {
  it('both stay finite numbers in [0,1] across a range of inputs', () => {
    const pairs: Array<[PhotoAnalysis, PhotoAnalysis]> = [
      [photo('range-a-ref'), photo('range-a-mine')],
      [photo('range-b-ref', { C: 0.02, hue: 10 }), photo('range-b-mine', { C: 0.2, hue: 250 })],
      [photo('range-c-ref', { baseline: 'preview' }), photo('range-c-mine')],
      [
        photo('range-d-ref', { curve: (v) => Math.min(1, v * 1.4) }),
        photo('range-d-mine', { curve: (v) => v * 0.6 }),
      ],
      [photo('range-e-ref', { C: 0.35, hue: 90 }), photo('range-e-mine', { C: 0.01, hue: 30 })],
    ];
    for (const [ref, mine] of pairs) {
      const sol = solveMatch(ref, mine);
      assert.ok(Number.isFinite(sol.confidence), `confidence not finite for ${ref.id}/${mine.id}: ${sol.confidence}`);
      assert.ok(sol.confidence >= 0 && sol.confidence <= 1, `confidence out of [0,1]: ${sol.confidence}`);
      assert.ok(Number.isFinite(sol.reachability), `reachability not finite for ${ref.id}/${mine.id}: ${sol.reachability}`);
      assert.ok(sol.reachability >= 0 && sol.reachability <= 1, `reachability out of [0,1]: ${sol.reachability}`);
    }
  });

  it('can be well-measured (high confidence) while being hard to actually close (lower reachability)', () => {
    // Two 'export'-baseline photos — the highest-fidelity reading, so nothing
    // should hold confidence down — but with lightness, chroma and hue pulled
    // apart in every region, so the gap the clamped controls can close is a
    // separate question from how well either photo was measured.
    const ref = photo('mismatch-ref', {
      curve: (v) => Math.min(1, 0.3 + v * 0.9),
      C: 0.15,
      hue: 200,
    });
    const mine = photo('mismatch-mine', {
      curve: (v) => v * 0.5,
      C: 0.02,
      hue: 20,
    });
    const sol = solveMatch(ref, mine);

    assert.ok(sol.confidence > 0.7, `expected high-ish confidence, got ${sol.confidence}`);
    assert.ok(Number.isFinite(sol.reachability));
    assert.ok(sol.reachability >= 0 && sol.reachability <= 1);
    // The whole point of the distinction the header comment draws: knowing
    // the numbers well (confidence) is not the same as being able to close
    // the gap between them (reachability).
    assert.ok(
      sol.reachability < sol.confidence,
      `expected reachability (${sol.reachability}) to lag confidence (${sol.confidence}) for two unrelated photographs`,
    );
  });
});

/* ── Baseline note ─────────────────────────────────────────────────────────── */

describe('the baseline note', () => {
  it('warns when either photo was read from a camera-embedded preview', () => {
    const sol = solveMatch(photo('baseline-ref'), photo('baseline-mine', { baseline: 'preview' }));
    const note = sol.notes.find((n) => n.panel === 'Baseline');
    assert.ok(note, 'expected a Baseline note when one photo is a camera preview');
    assert.equal(note!.severity, 'caution');
  });

  it('is silent when both photos are Lightroom zero-slider exports', () => {
    const sol = solveMatch(photo('baseline-ref-2'), photo('baseline-mine-2'));
    assert.ok(!sol.notes.some((n) => n.panel === 'Baseline'), 'unexpected Baseline note for two exports');
  });
});

/* ── Extreme-controls note ────────────────────────────────────────────────── */

describe('the extreme-controls note', () => {
  it('warns when the grade pins three or more controls near their limits', () => {
    // A huge, one-directional chroma and hue gap: Saturation, Temp and every
    // Colour Grading wheel all get driven toward their clamped ceiling.
    const ref = photo('extreme-ref', { C: 0.35, hue: 90 });
    const mine = photo('extreme-mine', { C: 0.01, hue: 30 });
    const sol = solveMatch(ref, mine);

    const note = sol.notes.find((n) => n.panel === 'Overall' && /pins \d+ controls?/.test(n.text));
    assert.ok(note, 'expected an extreme-controls note');
    assert.equal(note!.severity, 'caution');
  });

  it('is absent for a mild, easily-reachable gap', () => {
    const ref = photo('mild-ref', { C: 0.055, hue: 35 });
    const mine = photo('mild-mine', { C: 0.05, hue: 30 });
    const sol = solveMatch(ref, mine);

    assert.ok(
      !sol.notes.some((n) => n.panel === 'Overall' && /pins \d+ controls?/.test(n.text)),
      'unexpected extreme-controls note for a mild gap',
    );
  });
});

/* ── Shared curve x positions ─────────────────────────────────────────────── */

describe('curveX', () => {
  it('matches the x positions of both the restrained and the faithful curve', () => {
    // "Faithful first so its curve x positions define the shared grid" — the
    // property that lets atStrength blend the two without resampling.
    const cases: Array<[PhotoAnalysis, PhotoAnalysis]> = [
      [photo('curvex-self-ref'), photo('curvex-self-mine')],
      [photo('curvex-big-ref', { C: 0.35, hue: 90 }), photo('curvex-big-mine', { C: 0.01, hue: 30 })],
    ];
    for (const [ref, mine] of cases) {
      const sol = solveMatch(ref, mine);
      assert.deepEqual(sol.curveX, sol.faithful.curve.map((p) => p.x));
      assert.deepEqual(sol.curveX, sol.restrained.curve.map((p) => p.x));
    }
  });
});

/* ── Missing measurement ──────────────────────────────────────────────────── */

describe('a photo that could not be measured', () => {
  it('degrades gracefully instead of throwing, and says so', () => {
    const ref = photo('missing-ref');
    const mine = photo('missing-mine', { noRegions: true });

    let sol: MatchSolution | undefined;
    assert.doesNotThrow(() => {
      sol = solveMatch(ref, mine);
    });

    assert.ok(
      sol!.notes.some(
        (n) => n.severity === 'caution' && n.panel === 'Light' && /could not be measured/.test(n.text),
      ),
      'expected a caution note explaining the photo could not be measured',
    );
    assert.equal(sol!.reachability, 0);
    assert.equal(sol!.basicSlidersAreDescriptive, true);
  });
});

/* ── Determinism ───────────────────────────────────────────────────────────── */

describe('determinism', () => {
  it('is pure: same input twice gives deep-equal output, and mutates neither photo', () => {
    const ref = photo('det-ref', { C: 0.08, hue: 120 });
    const mine = photo('det-mine', { C: 0.03, hue: 40, baseline: 'preview' });
    const refBefore = structuredClone(ref);
    const mineBefore = structuredClone(mine);

    const first = solveMatch(ref, mine);

    assert.deepEqual(ref, refBefore, 'solveMatch mutated its `ref` argument');
    assert.deepEqual(mine, mineBefore, 'solveMatch mutated its `mine` argument');

    // Rebuilt from scratch — a separate but measurement-identical pair —
    // rather than reusing `ref`/`mine`, so this also catches any hidden
    // dependency on object identity.
    const second = solveMatch(
      photo('det-ref', { C: 0.08, hue: 120 }),
      photo('det-mine', { C: 0.03, hue: 40, baseline: 'preview' }),
    );

    assert.deepEqual(first, second);
  });
});
