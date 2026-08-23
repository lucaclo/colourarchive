/**
 * Tests for a group of reference measurements: region averaging shared with
 * `resemble.ts`, and whether one measures like a different edit from the
 * rest. Follows the same two rules `similar.ts`'s `rankSimilarGroup` already
 * established — average what's shared, leave out what wasn't measured rather
 * than zeroing it in — applied to a much richer measurement than a colour
 * grid. The weighted centroid actually solved against (`mergeReferences`,
 * for more than one reference) is tested in solve.test.ts alongside the rest
 * of the solver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { analysisOutliers, analysisResemblances, averageRegions } from './group.ts';
import { CLOSE_ENOUGH } from './resemble.ts';
import type { BaselineMode, HslBandStats, HueStats, PhotoAnalysis, RegionKey, RegionStats, TextureStats, VignetteStats } from './types.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const percentiles = (curve: (v: number) => number): number[] =>
  Array.from({ length: 21 }, (_, i) => curve(i / 20));

function region(key: RegionKey, opts: { L?: number; a?: number; b?: number; C?: number; sd?: number; hue?: HueStats; sampled?: number } = {}): RegionStats {
  const L = opts.L ?? 0.5;
  return {
    key,
    coverage: 0.4,
    sampled: opts.sampled ?? 50_000,
    L: { mean: L, sd: opts.sd ?? 0.2 },
    C: { mean: opts.C ?? 0.1, sd: 0.05 },
    hue: opts.hue ?? { mean: 30, strength: 0.8 },
    ab: { a: opts.a ?? 0.05, b: opts.b ?? 0.05 },
    percentiles: percentiles((v) => Math.min(1, Math.max(0, L + (v - 0.5) * 0.6))),
  };
}

const okTexture: TextureStats = {
  usable: true,
  blocked: 'none',
  normalised: true,
  nativeSize: { width: 2400, height: 1600 },
  grain: 0.02,
  grainSize: 1.4,
  acutance: 0.3,
  flatToEdge: 0.6,
  measuredAt: { width: 2400, height: 1600 },
};
const okVignette: VignetteStats = { falloffStops: -0.3, symmetry: 0.9, usable: true };

const hslBand = (key: HslBandStats['key'], weight: number, hue: number): HslBandStats => ({
  key,
  weight,
  chroma: 0.1,
  L: 0.5,
  hue,
});

let n = 0;
function analysis(opts: {
  regions: Partial<Record<RegionKey, RegionStats>>;
  baseline?: BaselineMode;
  texture?: TextureStats;
  vignette?: VignetteStats;
  hslBands?: HslBandStats[];
  warnings?: string[];
}): PhotoAnalysis {
  return {
    id: `a${n++}`,
    filename: 'photo.jpg',
    baseline: opts.baseline ?? 'native',
    width: 4000,
    height: 3000,
    sampledAt: 2400,
    regions: opts.regions,
    texture: opts.texture ?? okTexture,
    vignette: opts.vignette ?? okVignette,
    hslBands: opts.hslBands ?? [hslBand('red', 0.1, 28), hslBand('orange', 0.2, 62)],
    timings: {},
    warnings: opts.warnings ?? [],
  };
}

/* ── averageRegions ────────────────────────────────────────────────────────── */

describe('averageRegions', () => {
  it('excludes a reference missing a region rather than pulling it toward zero', () => {
    const withSky = region('scene.sky', { a: 0.2, b: 0.2 });
    const regionsA = { global: region('global'), 'scene.sky': withSky };
    const regionsB = { global: region('global') }; // no sky measured in this frame
    const out = averageRegions([regionsA, regionsB]);
    // If the missing region were zeroed in, sky's a/b would be halved (0.1),
    // not equal to the one real measurement.
    assert.equal(out['scene.sky']?.ab.a, 0.2);
    assert.equal(out['scene.sky']?.ab.b, 0.2);
  });

  it('averages the L/a/b and percentile curve of a region every reference shares', () => {
    const a = region('global', { L: 0.3, a: 0.1, b: 0.1 });
    const b = region('global', { L: 0.5, a: 0.3, b: -0.1 });
    const out = averageRegions([{ global: a }, { global: b }]);
    assert.equal(out.global?.ab.a, 0.2);
    assert.ok(Math.abs((out.global?.ab.b ?? NaN) - 0) < 1e-9);
    for (let i = 0; i < 21; i++) {
      assert.ok(Math.abs(out.global!.percentiles[i] - (a.percentiles[i] + b.percentiles[i]) / 2) < 1e-9);
    }
  });

  it('takes the minimum sample count rather than an average one — a group cannot claim more support than its thinnest member', () => {
    const a = region('global', { sampled: 100_000 });
    const b = region('global', { sampled: 500 });
    const out = averageRegions([{ global: a }, { global: b }]);
    assert.equal(out.global?.sampled, 500);
  });

  it('averages hue circularly: two readings either side of 0° do not average to 180°', () => {
    const a = region('global', { hue: { mean: 350, strength: 0.9 } });
    const b = region('global', { hue: { mean: 10, strength: 0.9 } });
    const out = averageRegions([{ global: a }, { global: b }]);
    assert.ok(out.global!.hue.mean < 20 || out.global!.hue.mean > 340, `${out.global!.hue.mean}`);
    assert.ok(out.global!.hue.strength > 0.7, `expected the readings to reinforce, got strength ${out.global!.hue.strength}`);
  });

  it('lets two disagreeing hues cancel toward a low-strength, untrustworthy mean', () => {
    const a = region('global', { hue: { mean: 30, strength: 0.9 } });
    const b = region('global', { hue: { mean: 210, strength: 0.9 } }); // opposite
    const out = averageRegions([{ global: a }, { global: b }]);
    assert.ok(out.global!.hue.strength < 0.1, `expected the opposite hues to cancel, got ${out.global!.hue.strength}`);
  });
});

/* ── analysisOutliers: reusing resemble.ts's own calibration ─────────────────── */

describe('analysisResemblances / analysisOutliers', () => {
  const shadow = (a: number, b: number) => region('zone.shadow', { L: 0.2, a, b, sampled: 50_000 });
  const highlight = (a: number, b: number) => region('zone.highlight', { L: 0.8, a, b, sampled: 50_000 });

  it('has nothing to compare a lone reference against, and refuses to blame either of just two', () => {
    const a = analysis({ regions: { global: region('global') } });
    const b = analysis({ regions: { global: region('global', { a: 0.5, b: 0.5 }) } });
    assert.equal(analysisResemblances([a]).length, 0);
    // Two references DO have a well-defined nearest-neighbour comparison —
    // it's the accusation ("which one is the outlier") that needs a third.
    assert.equal(analysisResemblances([a, b]).length, 2);
    assert.equal(analysisOutliers([a, b]).size, 0);
  });

  it('flags a reference whose grade genuinely differs from the rest, using compareLooks\' own threshold', () => {
    const alike = () => ({
      global: region('global', { L: 0.5, a: 0.05, b: 0.05, C: 0.1, sd: 0.2 }),
      'zone.shadow': shadow(0.02, 0.02),
      'zone.midtone': region('zone.midtone', { L: 0.5 }),
      'zone.highlight': highlight(0.08, 0.08),
    });
    const a = analysis({ regions: alike() });
    const b = analysis({ regions: alike() });
    // A visibly different grade: heavy cast, blown contrast, inverted split.
    const outlier = analysis({
      regions: {
        global: region('global', { L: 0.5, a: -0.6, b: 0.5, C: 0.35, sd: 0.55 }),
        'zone.shadow': shadow(0.5, -0.4),
        'zone.midtone': region('zone.midtone', { L: 0.5 }),
        'zone.highlight': highlight(-0.5, 0.4),
      },
    });
    const flagged = analysisOutliers([a, b, outlier]);
    assert.ok(flagged.has(outlier.id), [...flagged].join(','));
    assert.equal(flagged.size, 1);

    const own = analysisResemblances([a, b, outlier]).find((r) => r.id === outlier.id)!;
    assert.ok(own.nearest.distance > CLOSE_ENOUGH);
  });

  it('flags nothing when the whole group measures alike', () => {
    const alike = (jitter: number) => ({
      global: region('global', { L: 0.5, a: 0.05 + jitter, b: 0.05 - jitter, C: 0.1, sd: 0.2 }),
    });
    const a = analysis({ regions: alike(0) });
    const b = analysis({ regions: alike(0.005) });
    const c = analysis({ regions: alike(-0.005) });
    assert.equal(analysisOutliers([a, b, c]).size, 0);
  });
});
