import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { identityAdjustments, type Adjustments } from './adjustments';
import { DEFAULT_CALIBRATION } from './calibration';
import {
  calibrationRows, compareEdit, evalCurve, fitCalibration, followUpAdjustments, handMoves,
  olsThroughOrigin, roundTripEligibility, withApproved, type CalRow,
} from './roundtrip';
import { HSL_BANDS, type PhotoAnalysis, type RegionStats } from './types';

// --- Fixtures ---------------------------------------------------------------

interface Look { L?: number; C?: number; a?: number; b?: number; spread?: number; grain?: number; vignette?: number; band?: { chroma: number; L: number; hue: number } }

function region(l: Look): RegionStats {
  const L = l.L ?? 0.5, spread = l.spread ?? 0.4;
  return {
    key: 'global', coverage: 1, sampled: 10_000,
    L: { mean: L, sd: 0.2 }, C: { mean: l.C ?? 0.06, sd: 0.02 },
    hue: { mean: 40, strength: 0.5 },
    ab: { a: l.a ?? 0.01, b: l.b ?? 0.02 },
    percentiles: Array.from({ length: 21 }, (_, i) => Math.min(1, Math.max(0, L + (i / 20 - 0.5) * spread))),
  } as RegionStats;
}

function analysis(l: Look = {}, size = { width: 3000, height: 2000 }): PhotoAnalysis {
  return {
    id: 'x', filename: 'x.jpg', baseline: 'export', ...size, sampledAt: 1600,
    regions: { global: region(l) },
    texture: { usable: true, blocked: 'none', normalised: true, nativeSize: size, grain: l.grain ?? 0.01, grainSize: 1.5, acutance: 0.2 } as PhotoAnalysis['texture'],
    vignette: { falloffStops: l.vignette ?? 0, symmetry: 1, usable: true } as PhotoAnalysis['vignette'],
    hslBands: HSL_BANDS.map((b, i) => ({
      key: b.key, weight: i === 0 ? 0.3 : 0,
      chroma: l.band?.chroma ?? 0.1, L: l.band?.L ?? 0.5, hue: l.band?.hue ?? b.H,
    })),
    timings: {}, warnings: [],
  };
}

const adj = (over: Partial<Adjustments> = {}): Adjustments => ({ ...identityAdjustments([0, 64, 128, 192, 255]), ...over });

// --- compareEdit ---------------------------------------------------------------

describe('compareEdit', () => {
  it('reports the share of each gap the edit closed', () => {
    const mine = analysis({ L: 0.4, C: 0.04 });
    const ref = analysis({ L: 0.6, C: 0.08 });
    const edited = analysis({ L: 0.55, C: 0.07 });
    const c = compareEdit(mine, edited, ref);
    const bright = c.rows.find((r) => r.key === 'brightness')!;
    assert.ok(Math.abs(bright.closed! - 0.75) < 1e-6);
    assert.match(bright.text, /75% of the gap closed; still darker/);
    const colour = c.rows.find((r) => r.key === 'colourfulness')!;
    assert.ok(Math.abs(colour.closed! - 0.75) < 1e-6);
  });

  it('says so when the edit overshot, rather than calling it progress', () => {
    const c = compareEdit(analysis({ L: 0.4 }), analysis({ L: 0.7 }), analysis({ L: 0.6 }));
    assert.match(c.rows.find((r) => r.key === 'brightness')!.text, /overshot — now brighter/);
  });

  it('does not invent a percentage for a quantity that was already matched', () => {
    const c = compareEdit(analysis({ L: 0.6 }), analysis({ L: 0.601 }), analysis({ L: 0.6 }));
    const bright = c.rows.find((r) => r.key === 'brightness')!;
    assert.equal(bright.closed, null);
    assert.match(bright.text, /already matched/);
  });

  it('names the direction of a remaining cast', () => {
    const c = compareEdit(analysis({ a: 0, b: 0 }), analysis({ a: 0, b: 0.01 }), analysis({ a: 0, b: 0.03 }));
    assert.match(c.rows.find((r) => r.key === 'cast')!.text, /reference is warmer/);
  });
});

// --- followUpAdjustments ----------------------------------------------------------

describe('followUpAdjustments', () => {
  it('is the applied preset unchanged when there is nothing to correct', () => {
    const applied = adj({ exposure: 0.4, saturation: 12, curve: [{ x: 0, y: 10 }, { x: 128, y: 140 }, { x: 255, y: 250 }] });
    const out = followUpAdjustments(applied, adj());
    assert.equal(out.exposure, 0.4);
    assert.equal(out.saturation, 12);
    for (const x of [0, 64, 128, 200, 255]) assert.ok(Math.abs(evalCurve(out.curve, x) - evalCurve(applied.curve, x)) <= 1);
  });

  it('adds the correction rather than replacing the first preset', () => {
    const out = followUpAdjustments(adj({ saturation: 20, vignette: -10 }), adj({ saturation: 8, vignette: -5 }));
    assert.equal(out.saturation, 28);
    assert.equal(out.vignette, -15);
  });

  it('folds a corrective exposure into the curve, after the first curve', () => {
    const out = followUpAdjustments(adj(), adj({ exposure: 1 }));
    assert.equal(out.exposure, 0);
    assert.ok(evalCurve(out.curve, 128) > 160, 'midtones brightened by about a stop');
    assert.equal(evalCurve(out.curve, 255), 255, 'white stays white');
  });

  it('adds grading wheels as vectors, so opposite casts cancel', () => {
    const out = followUpAdjustments(
      adj({ grading: { ...adj().grading, global: { hue: 30, sat: 20, lum: 0 } } }),
      adj({ grading: { ...adj().grading, global: { hue: 210, sat: 20, lum: 0 } } }),
    );
    assert.ok(out.grading.global.sat < 0.01);
  });

  it('clamps at Lightroom’s limits', () => {
    assert.equal(followUpAdjustments(adj({ saturation: 90 }), adj({ saturation: 30 })).saturation, 100);
  });
});

describe('handMoves', () => {
  it('lists only moves big enough to make by hand', () => {
    const moves = handMoves(adj({ saturation: 12, vibrance: 1, texture: 3 }));
    assert.deepEqual(moves.map((m) => m.control), ['Saturation']);
  });
});

// --- eligibility ---------------------------------------------------------------

describe('roundTripEligibility', () => {
  const ok = { appliedAs: 'unchanged' as const, baseline: 'export' as const, hadMasks: false, mine: { width: 3000, height: 2000 }, edited: { width: 1500, height: 1000 } };
  it('accepts the one case that means something', () => {
    assert.deepEqual(roundTripEligibility(ok), { eligible: true, reasons: [] });
  });
  it('gives a reason for each thing that spoils it', () => {
    const r = roundTripEligibility({ ...ok, appliedAs: 'changed', baseline: 'macos', hadMasks: true, edited: { width: 1000, height: 1000 } });
    assert.equal(r.eligible, false);
    assert.equal(r.reasons.length, 4);
  });
});

// --- calibration -------------------------------------------------------------

/** Rows as a Lightroom with calibration `truth` would produce them. */
function syntheticChroma(sat: number, vib: number, tone: number, truth = { gS: 1.3, gV: 2.1 }, noise = 0): CalRow {
  return {
    group: 'chroma',
    x: { saturation: sat, vibrance: vib, '~tone': tone, '~grade': 0 },
    y: sat / (100 * truth.gS) + vib / (100 * truth.gV) + 0.8 * tone + noise,
  };
}

describe('fitCalibration', () => {
  it('recovers Saturation and Vibrance jointly once their mix varies', () => {
    const rows = [
      syntheticChroma(20, 10, 0.02, undefined, 0.0004),
      syntheticChroma(5, 30, -0.01, undefined, -0.0003),
      syntheticChroma(30, 5, 0.05, undefined, 0.0002),
      syntheticChroma(12, 18, 0.0, undefined, -0.0001),
      syntheticChroma(-15, 20, 0.03, undefined, 0.0003),
    ];
    const byKey = Object.fromEntries(fitCalibration(rows).map((p) => [p.key, p]));
    assert.equal(byKey.saturationGain.status, 'fitted');
    assert.ok(Math.abs(byKey.saturationGain.value! - 1.3) < 0.1, `got ${byKey.saturationGain.value}`);
    assert.equal(byKey.vibranceGain.status, 'fitted');
    assert.ok(Math.abs(byKey.vibranceGain.value! - 2.1) < 0.2, `got ${byKey.vibranceGain.value}`);
  });

  it('refuses to split two controls that always moved in the same ratio', () => {
    // The restrained solution's fixed 0.7/0.3 split, every time.
    const rows = [10, 20, 30, 40].map((m, i) => syntheticChroma(0.3 * m, 0.7 * m, 0.01 * i));
    const sat = fitCalibration(rows).find((p) => p.key === 'saturationGain')!;
    assert.equal(sat.status, 'confounded');
    assert.match(sat.text, /Vibrance/);
  });

  it('asks for more round trips below the minimum', () => {
    const p = fitCalibration([syntheticChroma(20, 0, 0), syntheticChroma(30, 0, 0)]).find((x) => x.key === 'saturationGain')!;
    assert.equal(p.status, 'needs-more');
    assert.equal(p.points, 2);
  });

  it('flags a fit wildly off the estimate as implausible, not as a discovery', () => {
    const rows = [10, 20, 30, 40].map((v, i) => ({ group: 'vignette' as const, x: { vignette: -v }, y: v * 0.5 + i * 1e-4 }));
    const p = fitCalibration(rows).find((x) => x.key === 'vignetteStopsAt100')!;
    assert.equal(p.status, 'implausible');
  });

  it('fits a single-control group from clean rows', () => {
    const truth = 1.8; // stops at -100
    const rows = [-20, -40, -60, -80].map((v, i) => ({ group: 'vignette' as const, x: { vignette: v }, y: (v * truth) / 100 + (i % 2 ? 1e-3 : -1e-3) }));
    const p = fitCalibration(rows).find((x) => x.key === 'vignetteStopsAt100')!;
    assert.equal(p.status, 'fitted');
    assert.ok(Math.abs(p.value! - truth) < 0.02);
  });

  it('counts evidence in round trips, not in the band rows one photo yields', () => {
    const rows: CalRow[] = [0, 1, 2, 3].map((i) => ({ group: 'hslSat', x: { hslSat: 20 + i }, y: (20 + i) / 100, source: 'one-photo' }));
    const p = fitCalibration(rows).find((x) => x.key === 'hslSaturationGain')!;
    assert.equal(p.status, 'needs-more');
    assert.equal(p.points, 1);
  });
});

describe('olsThroughOrigin', () => {
  it('solves an exactly determined system', () => {
    const rows: CalRow[] = [
      { group: 'chroma', x: { a: 1, b: 0 }, y: 2 },
      { group: 'chroma', x: { a: 0, b: 1 }, y: 3 },
      { group: 'chroma', x: { a: 1, b: 1 }, y: 5 },
    ];
    const fit = olsThroughOrigin(rows);
    assert.ok(fit.ok);
    assert.ok(Math.abs(fit.beta[fit.names.indexOf('a')] - 2) < 1e-9);
    assert.ok(Math.abs(fit.beta[fit.names.indexOf('b')] - 3) < 1e-9);
  });
});

describe('calibrationRows', () => {
  it('reads a pure Saturation move back out of two analyses', () => {
    const base = analysis({ C: 0.05 });
    const edited = analysis({ C: 0.06 });
    const rows = calibrationRows(base, edited, adj({ saturation: 20 }));
    const chroma = rows.find((r) => r.group === 'chroma')!;
    assert.equal(chroma.x.saturation, 20);
    assert.ok(Math.abs(chroma.y - 0.2) < 1e-9);
  });

  it('skips texture rows when the two measurements are not comparable', () => {
    const base = analysis();
    const edited = analysis();
    edited.texture = { ...edited.texture, normalised: false };
    assert.equal(calibrationRows(base, edited, adj()).some((r) => r.group === 'grain'), false);
  });
});

describe('withApproved', () => {
  it('overlays only known, finite keys', () => {
    const cal = withApproved({ saturationGain: 1.4, bogus: 3, vibranceGain: NaN } as never);
    assert.equal(cal.saturationGain, 1.4);
    assert.equal(cal.vibranceGain, DEFAULT_CALIBRATION.vibranceGain);
    assert.equal('bogus' in cal, false);
  });
});

describe('Point Color in the follow-up', () => {
  const swatch = (region: 'people.skin' | 'scene.foliage', sat: number) => ({
    region, label: region === 'people.skin' ? 'Skin' : 'Foliage', source: [0.3, 0.5, 0.4] as [number, number, number],
    hue: 0, sat, lum: 0, range: 50,
    hueRange: [0, 1 / 3, 2 / 3, 1] as [number, number, number, number],
    satRange: [0, 0.32, 0.68, 1] as [number, number, number, number],
    lumRange: [0, 0.4, 0.76, 1] as [number, number, number, number], rationale: '',
  });

  it('adds swatches for the same region and keeps the first one’s colour', () => {
    const applied = { ...identityAdjustments(), pointColors: [swatch('people.skin', -20)] };
    const corrective = { ...identityAdjustments(), pointColors: [{ ...swatch('people.skin', -10), source: [0.5, 0.6, 0.5] as [number, number, number] }, swatch('scene.foliage', 15)] };
    const out = followUpAdjustments(applied, corrective);
    const skin = out.pointColors.find((p) => p.region === 'people.skin')!;
    assert.equal(skin.sat, -30);
    assert.deepEqual(skin.source, [0.3, 0.5, 0.4]);
    assert.equal(out.pointColors.find((p) => p.region === 'scene.foliage')!.sat, 15);
  });

  it('lists a swatch as a move to make by hand', () => {
    const moves = handMoves({ ...identityAdjustments(), pointColors: [swatch('people.skin', -12)] });
    assert.ok(moves.some((m) => m.control === 'Point Color › Skin' && m.delta === 'Sat -12'), JSON.stringify(moves));
  });
});
