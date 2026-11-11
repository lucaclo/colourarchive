import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { solveAndRefine } from './engine';
import { lrTables } from './lr-tables-node';
import type { LrTables } from './lr-model';
import { asMonochrome, monochromeOf } from './monochrome';
import { closeness, simulate, targetFromAnalysis } from './simulate';
import { decodeSample, measureRegionsFromPixels } from './stats-core';
import { ANALYSIS_VERSION, NO_MASKS, type PhotoAnalysis, type RgbImage } from './types';
import { identityAdjustments } from './adjustments';

let T: LrTables;
before(async () => {
  T = await lrTables();
});

const W = 96;
const H = 64;

/** A colourful card, then the same card made grey or toned. */
function card(mode: 'colour' | 'grey' | 'sepia'): RgbImage {
  const data = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const t = x / (W - 1);
      const u = y / (H - 1);
      const rgb = y < 24
        ? [90 + 60 * t, 140 + 50 * t, 200 + 40 * t]
        : [(30 + 160 * t) * 1.1, (30 + 160 * t) * 0.85, (30 + 160 * t) * 0.55 + 20 * u];
      const grey = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      const out = mode === 'colour' ? rgb : mode === 'grey' ? [grey, grey, grey] : [grey * 1.08, grey * 0.98, grey * 0.84];
      data.set(out.map((v) => Math.max(0, Math.min(255, Math.round(v)))), o);
    }
  }
  return { data, width: W, height: H, channels: 3 };
}

function analyse(img: RgbImage, id: string): PhotoAnalysis {
  const m = measureRegionsFromPixels(img, NO_MASKS(img.width, img.height));
  return {
    id, filename: id, baseline: 'export', width: img.width, height: img.height, sampledAt: m.sampledAt,
    regions: m.regions, hslBands: m.hslBands,
    texture: { usable: false, blocked: 'resolution', normalised: false, nativeSize: { width: W, height: H }, grain: 0, grainSize: 0, acutance: 0, flatToEdge: 0, measuredAt: { width: W, height: H } },
    vignette: { falloffStops: 0, symmetry: 0, usable: false }, timings: {}, warnings: [],
    version: ANALYSIS_VERSION, sample: m.sample,
  };
}

describe('monochromeOf', () => {
  it('tells grey, toned and colour apart', () => {
    assert.equal(monochromeOf(analyse(card('grey'), 'g')), 'mono');
    assert.equal(monochromeOf(analyse(card('sepia'), 's')), 'toned');
    assert.equal(monochromeOf(analyse(card('colour'), 'c')), null);
  });
});

describe('asMonochrome', () => {
  it('takes every colour move out and keeps the luminance mix', () => {
    const a = identityAdjustments();
    a.saturation = 20;
    a.vibrance = 15;
    a.hsl.blue = { hue: 10, sat: 30, lum: -25 };
    a.grading.shadows = { hue: 200, sat: 20, lum: 0 };
    const m = asMonochrome(a, 'mono');
    assert.equal(m.saturation, -100);
    assert.equal(m.vibrance, 0);
    assert.deepEqual(m.hsl.blue, { hue: 0, sat: 0, lum: -25 });
    assert.equal(m.grading.shadows.sat, 0);
    // A toned print keeps the wheels that put its tint back.
    assert.equal(asMonochrome(a, 'toned').grading.shadows.sat, 20);
  });
});

describe('a black-and-white reference', () => {
  it('gets a grey answer at full and in the middle', () => {
    const ref = analyse(card('grey'), 'ref');
    const mine = analyse(card('colour'), 'mine');
    const s = solveAndRefine(ref, mine, { tables: T });
    assert.equal(s.faithful.saturation, -100);
    assert.equal(s.restrained.saturation, -100);
    const sample = decodeSample(mine.sample!);
    const after = simulate(s.faithful, sample, T);
    const meanC = after.regions.global!.C.mean;
    assert.ok(meanC < 0.01, `simulated chroma ${meanC}`);
    // And it lands nearer the reference than leaving the photo alone.
    const target = targetFromAnalysis(ref);
    const untouched = closeness(simulate(identityAdjustments(s.curveX), sample, T), target);
    assert.ok(closeness(after, target).distance < untouched.distance);
  });
});
