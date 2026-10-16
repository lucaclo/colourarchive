import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { identityAdjustments, type Adjustments } from './adjustments';
import { composeReference } from './composition';
import { solveAndRefine } from './engine';
import { prepareLr, renderLinear, srgbEncode, type LrTables } from './lr-model';
import { lrTables } from './lr-tables-node';
import { closeness, simulate, targetFromAnalysis } from './simulate';
import { solveMatch } from './solve';
import { decodeSample, measureRegionsFromPixels } from './stats-core';
import { ANALYSIS_VERSION, NO_MASKS, type PhotoAnalysis, type RegionKey, type RegionMasks, type RgbImage } from './types';

let T: LrTables;
before(async () => {
  T = await lrTables();
});

const W = 96;
const H = 64;

/** A photo-like test card: a sky band on top, a warm ground below, with
 *  gradients and some colour variety so every zone and several bands exist. */
function card(skyRows = 24): RgbImage {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const t = x / (W - 1);
      if (y < skyRows) {
        data.set([Math.round(90 + 60 * t), Math.round(140 + 50 * t), Math.round(200 + 40 * t)], o);
      } else {
        const u = (y - skyRows) / Math.max(1, H - skyRows);
        const v = 30 + 160 * t * (1 - 0.5 * u);
        data.set([Math.round(v * 1.1), Math.round(v * 0.85), Math.round(v * 0.55 + 20 * u)], o);
      }
    }
  }
  return { data, width: W, height: H, channels: 3 };
}

function skyMasks(skyRows: number): RegionMasks {
  const sky = new Uint8Array(W * H);
  const ground = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) (y < skyRows ? sky : ground)[y * W + x] = 255;
  return {
    width: W, height: H,
    masks: { 'scene.sky': sky, 'scene.ground': ground },
    full: { 'scene.sky': sky, 'scene.ground': ground },
    coverage: { 'scene.sky': skyRows / H, 'scene.ground': 1 - skyRows / H },
    warnings: [], timings: {},
  };
}

function analyse(img: RgbImage, id: string, masks: RegionMasks = NO_MASKS(img.width, img.height)): PhotoAnalysis {
  const m = measureRegionsFromPixels(img, masks);
  return {
    id, filename: id, baseline: 'export', width: img.width, height: img.height, sampledAt: m.sampledAt,
    regions: m.regions, hslBands: m.hslBands,
    texture: { usable: false, blocked: 'resolution', normalised: false, nativeSize: { width: W, height: H }, grain: 0, grainSize: 0, acutance: 0, flatToEdge: 0, measuredAt: { width: W, height: H } },
    vignette: { falloffStops: 0, symmetry: 0, usable: false }, timings: {}, warnings: [],
    version: ANALYSIS_VERSION, sample: m.sample,
  };
}

function grade(img: RgbImage, adj: Adjustments): RgbImage {
  const prep = prepareLr(adj, T);
  const out = new Uint8Array(img.data.length);
  const px = new Float64Array(3);
  const dec = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  for (let i = 0; i < W * H; i++) {
    renderLinear(prep, dec(img.data[i * 3]), dec(img.data[i * 3 + 1]), dec(img.data[i * 3 + 2]), null, px);
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(srgbEncode(px[c]) * 255);
  }
  return { ...img, data: out };
}

function warmFade(): Adjustments {
  const a = identityAdjustments();
  a.exposure = 0.3;
  a.curve = [{ x: 0, y: 14 }, { x: 64, y: 58 }, { x: 128, y: 132 }, { x: 192, y: 200 }, { x: 255, y: 250 }];
  a.saturation = -15;
  a.grading.global = { hue: 40, sat: 18, lum: 0 };
  a.grading.shadows = { hue: 200, sat: 25, lum: 0 };
  return a;
}

describe('simulate', () => {
  it('with no grade, reproduces the photo’s own measurements', () => {
    const mine = analyse(card(), 'mine');
    const sim = simulate(identityAdjustments(), decodeSample(mine.sample!), T);
    const c = closeness(sim, targetFromAnalysis(mine));
    assert.ok(c.deltaE < 0.5, `ΔE ${c.deltaE}`);
    assert.ok(c.toneLevels < 1.5, `tone ${c.toneLevels}`);
  });
});

describe('refine', () => {
  it('closes a known Lightroom grade far better than the solver alone', () => {
    const img = card();
    const mine = analyse(img, 'mine');
    const ref = analyse(grade(img, warmFade()), 'ref');
    const sol = solveAndRefine(ref, mine, { tables: T });
    assert.ok(sol.predicted, 'a prediction is reported');
    const p = sol.predicted!;
    assert.ok(p.faithful.deltaE < p.unrefined.deltaE, `${p.faithful.deltaE} vs ${p.unrefined.deltaE}`);
    assert.ok(p.faithful.deltaE < 1.5, `refined ΔE ${p.faithful.deltaE}`);
    assert.ok(p.faithful.toneLevels < p.untouched.toneLevels / 3);
  });

  it('keeps the shared curve grid, so the strength slider still blends', () => {
    const img = card();
    const sol = solveAndRefine(analyse(grade(img, warmFade()), 'ref'), analyse(img, 'mine'), { tables: T });
    assert.deepEqual(sol.faithful.curve.map((p) => p.x), sol.curveX);
    assert.deepEqual(sol.restrained.curve.map((p) => p.x), sol.curveX);
  });

  it('the restrained solution stays nearer the photo than the faithful one', () => {
    const img = card();
    const sol = solveAndRefine(analyse(grade(img, warmFade()), 'ref'), analyse(img, 'mine'), { tables: T });
    const p = sol.predicted!;
    assert.ok(p.restrained.distance > p.faithful.distance);
    assert.ok(p.restrained.distance < p.untouched.distance);
  });

  it('leaves the solution alone without a pixel sample (an old analysis)', () => {
    const img = card();
    const ref = analyse(grade(img, warmFade()), 'ref');
    const mine = { ...analyse(img, 'mine'), sample: undefined };
    const sol = solveAndRefine(ref, mine, { tables: T });
    assert.equal(sol.predicted, undefined);
    assert.deepEqual(sol.faithful, solveMatch(ref, mine).faithful);
  });

  it('without the measured tables, the solver’s answer stands', () => {
    const img = card();
    const ref = analyse(grade(img, warmFade()), 'ref');
    const mine = analyse(img, 'mine');
    assert.deepEqual(solveAndRefine(ref, mine, { tables: null }).faithful, solveMatch(ref, mine).faithful);
  });
});

describe('composition', () => {
  it('reads a sky-heavy reference in your proportions', () => {
    // Same treatment, different framing: the reference is 75% sky, yours 25%.
    const refImg = card(48);
    const mineImg = card(16);
    const ref = analyse(refImg, 'ref', skyMasks(48));
    const mine = analyse(mineImg, 'mine', skyMasks(16));
    const composed = composeReference(ref, mine)!;
    assert.ok(composed, 'composition applies');
    assert.ok(composed.mismatch > 0.4, `mismatch ${composed.mismatch}`);
    const L = (a: PhotoAnalysis) => a.regions.global!.L.mean;
    // Re-weighted, the reference's frame looks like yours: same content mix,
    // same treatment, so nearly the same average lightness.
    assert.ok(Math.abs(L(composed.reference) - L(mine)) < Math.abs(L(ref) - L(mine)) / 3);
    // Region statistics are left as they were.
    assert.deepEqual(composed.reference.regions['scene.sky' as RegionKey], ref.regions['scene.sky' as RegionKey]);
  });

  it('a match across different framings asks for less when composed', () => {
    const ref = analyse(card(48), 'ref', skyMasks(48));
    const mine = analyse(card(16), 'mine', skyMasks(16));
    // Identical treatment: the right answer is (almost) nothing.
    const composed = solveAndRefine(ref, mine, { tables: T });
    const raw = solveMatch(ref, mine);
    assert.ok(Math.abs(composed.faithful.exposure) < Math.abs(raw.faithful.exposure) || Math.abs(composed.faithful.exposure) < 0.1);
    assert.ok(composed.notes.some((n) => n.text.includes('proportions')));
  });

  it('is skipped when neither photo was segmented', () => {
    assert.equal(composeReference(analyse(card(), 'a'), analyse(card(), 'b')), null);
  });
});

describe('several references', () => {
  it('count by how alike their make-up is to your photo', () => {
    const mine = analyse(card(16), 'mine', skyMasks(16));
    const alike = analyse(card(20), 'alike', skyMasks(20));
    const unlike = analyse(card(56), 'unlike', skyMasks(56));
    const sol = solveAndRefine([{ analysis: alike, weight: 1 }, { analysis: unlike, weight: 1 }], mine, { tables: T });
    const note = sol.notes.find((n) => n.text.startsWith('The references count by'));
    assert.ok(note, 'the weighting is explained');
    const share = (name: string) => Number(new RegExp(`${name} (\\d+)%`).exec(note!.text)![1]);
    assert.ok(share('alike') > share('unlike'), note!.text);
  });
});

describe('Point Color', () => {
  /** A scene: warm ground with a green foliage block, the block masked. */
  function foliageCard(): { img: RgbImage; masks: RegionMasks } {
    const img = card(0);
    const fol = new Uint8Array(W * H);
    for (let y = 8; y < 40; y++) {
      for (let x = 10; x < 60; x++) {
        const o = (y * W + x) * 3;
        const t = (x - 10) / 50;
        img.data.set([Math.round(40 + 30 * t), Math.round(110 + 50 * t), Math.round(35 + 20 * t)], o);
        fol[y * W + x] = 255;
      }
    }
    // Other greens that aren't foliage — dim and muted, like a painted door —
    // which the reference leaves alone. The mixer's Green band can't tell them
    // apart from the leaves; Point Color's ranges can.
    for (let y = 44; y < 60; y++) {
      for (let x = 10; x < 86; x++) img.data.set([24 + (x % 5), 42 + (x % 7), 26], (y * W + x) * 3);
    }
    const share = (32 * 50) / (W * H);
    return {
      img,
      masks: { width: W, height: H, masks: { 'scene.foliage': fol }, full: { 'scene.foliage': fol }, coverage: { 'scene.foliage': share }, warnings: [], timings: {} },
    };
  }

  it('carries a foliage-only change in the preset, where neither a drawn mask nor a band could', () => {
    const { img, masks } = foliageCard();
    // The reference: the same photo with only its greens turned and muted.
    const out = new Uint8Array(img.data);
    for (let i = 0; i < W * H; i++) {
      if (!masks.masks['scene.foliage']![i]) continue;
      const [r, g, b] = [img.data[i * 3], img.data[i * 3 + 1], img.data[i * 3 + 2]];
      out.set([Math.round(r * 0.9 + 25), Math.round(g * 0.82), Math.round(b * 0.9 + 18)], i * 3);
    }
    const ref = analyse({ ...img, data: out }, 'ref', masks);
    const mine = analyse(img, 'mine', masks);
    const sol = solveAndRefine(ref, mine, { tables: T });
    const swatch = sol.faithful.pointColors.find((p) => p.region === 'scene.foliage');
    assert.ok(swatch, `a foliage swatch: ${JSON.stringify(sol.faithful.pointColors)}`);
    assert.ok(!sol.faithful.masks.some((m) => m.region === 'scene.foliage'), 'no mask to draw for it');
    const p = sol.predicted!;
    assert.ok((p.faithful.regions['scene.foliage'] ?? 99) < (p.untouched.regions['scene.foliage'] ?? 0) * 0.5, JSON.stringify(p.faithful.regions));
    // And the restrained solution holds the same swatch back.
    const r = sol.restrained.pointColors.find((q) => q.region === 'scene.foliage')!;
    assert.ok(Math.abs(r.sat) < Math.abs(swatch.sat) || Math.abs(r.hue) < Math.abs(swatch.hue));
  });
});
