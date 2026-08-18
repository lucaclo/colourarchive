/**
 * Tests for the pure pixel maths — the half of Style Match that runs
 * identically fed by sharp on the server or by a canvas in the browser.
 *
 * That "identically" is the whole reason this file is split out of stats.ts,
 * and it is also why these tests lean on `srgb255ToOklch` from `color.ts` as
 * an oracle: it is the SAME published OKLab matrices, so any place the two
 * disagree is either a genuine bug or a copy-paste drift between the two
 * files that would otherwise only surface as "the browser fallback reports
 * a slightly different grade than the Mac", which is exactly the failure
 * mode the split was meant to prevent.
 *
 * The other seam worth distrust is the weighting: zones are soft (every
 * pixel contributes to all three, fractionally), masked regions are hard
 * (>=128 in or out), and hue bands are gated on a chroma floor so a
 * black-and-white photo doesn't get invented colour. None of that is
 * obvious from the type signatures, so it is proven here against small
 * synthetic images rather than assumed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { measureRegionsFromPixels, measureVignetteFromPixels, zoneWeights } from './stats-core.ts';
import {
  HSL_BANDS,
  NO_MASKS,
  VIGNETTE_MIN_SYMMETRY,
  type RegionKey,
  type RegionMasks,
  type RgbImage,
} from './types.ts';
import { srgb255ToOklch } from '../color.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

type Rgb = [number, number, number];

/** A flat field of one colour — the base case for "no variance, known mean". */
function solidImage(w: number, h: number, rgb: Rgb, channels = 3): RgbImage {
  const data = new Uint8Array(w * h * channels);
  for (let i = 0; i < w * h; i++) {
    const p = i * channels;
    data[p] = rgb[0];
    data[p + 1] = rgb[1];
    data[p + 2] = rgb[2];
    if (channels === 4) data[p + 3] = 255;
  }
  return { data, width: w, height: h, channels };
}

/** Left half one colour, right half another — for proving a mask reads only
 *  the pixels it covers rather than blending across the whole frame. */
function splitImage(w: number, h: number, left: Rgb, right: Rgb): RgbImage {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < w / 2 ? left : right;
      const p = (y * w + x) * 3;
      data[p] = c[0];
      data[p + 1] = c[1];
      data[p + 2] = c[2];
    }
  }
  return { data, width: w, height: h, channels: 3 };
}

/** A radially symmetric gradient built with the SAME centre/radius formula
 *  `measureVignetteFromPixels` uses internally, so the four corner samples
 *  are exactly symmetric by construction regardless of image parity. */
function radialImage(size: number, centreByte: number, edgeByte: number): RgbImage {
  const data = new Uint8Array(size * size * 3);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const v = Math.round(centreByte + (edgeByte - centreByte) * r);
      const p = (y * size + x) * 3;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
    }
  }
  return { data, width: size, height: size, channels: 3 };
}

/** A bright field with ONE corner darkened — simulating a dark object sitting
 *  in frame rather than lens falloff, which affects all four corners equally.
 *  Uses the same quadrant split (`y<cy`, `x<cx`) as the code under test. */
function oneCornerDarkImage(size: number, brightByte: number, darkByte: number): RgbImage {
  const data = new Uint8Array(size * size * 3);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - cx, y - cy) / maxR;
      const inDarkCorner = r > 0.78 && y < cy && x < cx;
      const v = inDarkCorner ? darkByte : brightByte;
      const p = (y * size + x) * 3;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
    }
  }
  return { data, width: size, height: size, channels: 3 };
}

function buildMask(w: number, h: number, inside: (x: number, y: number) => boolean): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mask[y * w + x] = inside(x, y) ? 255 : 0;
  }
  return mask;
}

function masksOf(w: number, h: number, entries: Partial<Record<RegionKey, Uint8Array>>, coverage: Partial<Record<RegionKey, number>>): RegionMasks {
  return { width: w, height: h, masks: entries, full: {}, coverage, warnings: [], timings: {} };
}

/** Mirrors the internal nearest-hue-band lookup so a test picking a colour
 *  near a band's centre can predict which band it MUST land in, without
 *  duplicating any of the code under test's own logic for the answer. */
function nearestBandKey(H: number): (typeof HSL_BANDS)[number]['key'] {
  const circDist = (a: number, b: number) => {
    const d = Math.abs(((a - b) % 360 + 360) % 360);
    return d > 180 ? 360 - d : d;
  };
  let best = HSL_BANDS[0];
  let bd = Infinity;
  for (const band of HSL_BANDS) {
    const d = circDist(H, band.H);
    if (d < bd) { bd = d; best = band; }
  }
  return best.key;
}

/* ── zoneWeights ───────────────────────────────────────────────────────────── */

describe('zoneWeights', () => {
  it('always sums to 1', () => {
    for (const L of [0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1]) {
      const [s, m, h] = zoneWeights(L);
      assert.ok(Math.abs(s + m + h - 1) < 1e-12, `L=${L} summed to ${s + m + h}`);
    }
  });

  it('matches the piecewise-linear ramps at the domain edges and centre', () => {
    // s = max(0, 1 - L/0.5), h = max(0, (L-0.5)/0.5), m = max(0, 1-|L-0.5|/0.5).
    const cases: [number, [number, number, number]][] = [
      [0, [1, 0, 0]],
      [0.25, [0.5, 0.5, 0]],
      [0.5, [0, 1, 0]],
      [0.75, [0, 0.5, 0.5]],
      [1, [0, 0, 1]],
    ];
    for (const [L, expected] of cases) {
      const got = zoneWeights(L);
      for (let i = 0; i < 3; i++) {
        assert.ok(Math.abs(got[i] - expected[i]) < 1e-9, `L=${L} index ${i}: got ${got[i]}, want ${expected[i]}`);
      }
    }
  });

  it('concentrates entirely in midtone at L=0.5', () => {
    const [s, m, h] = zoneWeights(0.5);
    assert.equal(s, 0);
    assert.equal(h, 0);
    assert.ok(Math.abs(m - 1) < 1e-12);
  });
});

/* ── measureRegionsFromPixels ─────────────────────────────────────────────── */

describe('measureRegionsFromPixels', () => {
  it('reports zero spread and the hand-computed OKLCH mean on a flat image', () => {
    const rgb: Rgb = [180, 90, 40];
    const img = solidImage(24, 24, rgb);
    const { regions } = measureRegionsFromPixels(img, NO_MASKS());
    const g = regions.global!;
    assert.ok(g, 'global region missing');
    // Not exactly 0: summing 576 identical floats and subtracting mean^2
    // leaves a little floating-point cancellation noise, not real variance.
    assert.ok(g.L.sd < 1e-6, `L.sd was ${g.L.sd}`);
    assert.ok(g.C.sd < 1e-6, `C.sd was ${g.C.sd}`);

    const expected = srgb255ToOklch(...rgb);
    assert.ok(Math.abs(g.L.mean - expected.L) < 1e-9, `L.mean ${g.L.mean} vs oracle ${expected.L}`);
    assert.ok(Math.abs(g.C.mean - expected.C) < 1e-9, `C.mean ${g.C.mean} vs oracle ${expected.C}`);
    const hueDiff = Math.min(Math.abs(g.hue.mean - expected.H), 360 - Math.abs(g.hue.mean - expected.H));
    assert.ok(hueDiff < 1e-6, `hue.mean ${g.hue.mean} vs oracle ${expected.H}`);
    assert.equal(g.sampled, 24 * 24);
  });

  it('reads the same flat image whether the buffer is RGB or RGBA', () => {
    const rgb: Rgb = [60, 140, 200];
    const rgbImg = solidImage(10, 10, rgb, 3);
    const rgbaImg = solidImage(10, 10, rgb, 4);
    const a = measureRegionsFromPixels(rgbImg, NO_MASKS()).regions.global!;
    const b = measureRegionsFromPixels(rgbaImg, NO_MASKS()).regions.global!;
    assert.ok(Math.abs(a.L.mean - b.L.mean) < 1e-12);
    assert.ok(Math.abs(a.C.mean - b.C.mean) < 1e-12);
  });

  it('always reports the three luminance zones (no masks needed), splitting weight exactly per zoneWeights', () => {
    // A grey chosen so its OKLCH L sits away from 0/1, so no zone's weight is
    // exactly zero and all three must appear — the case the browser path
    // relies on, since it never has segmentation masks.
    const rgb: Rgb = [99, 99, 99];
    const w = 20, h = 20, N = w * h;
    const img = solidImage(w, h, rgb);
    const { L } = srgb255ToOklch(...rgb);
    const [ws, wm, wh] = zoneWeights(L);
    const { regions } = measureRegionsFromPixels(img, NO_MASKS());

    const zoneKeys = ['zone.shadow', 'zone.midtone', 'zone.highlight'] as const;
    const weights = [ws, wm, wh];
    for (let i = 0; i < 3; i++) {
      const key = zoneKeys[i];
      const expectedN = weights[i] * N;
      if (expectedN < 1e-6) {
        assert.equal(regions[key], undefined, `${key} should have been omitted (zero weight)`);
      } else {
        assert.ok(regions[key], `${key} missing`);
        assert.ok(Math.abs(regions[key]!.sampled - Math.round(expectedN)) <= 1, `${key} sampled was ${regions[key]!.sampled}, expected ~${expectedN}`);
      }
    }
  });

  it('reads a masked region from only the pixels it covers, not a blend', () => {
    const left: Rgb = [220, 40, 40];
    const right: Rgb = [20, 60, 220];
    const w = 40, h = 20;
    const img = splitImage(w, h, left, right);
    const mask = buildMask(w, h, (x) => x < w / 2);
    // Deliberately mismatched against the mask's actual pixel fraction (which
    // is 0.5) to prove coverage is threaded through from the caller verbatim
    // rather than recomputed from the mask itself.
    const masks = masksOf(w, h, { subject: mask }, { subject: 0.37 });

    const { regions } = measureRegionsFromPixels(img, masks);
    const subject = regions.subject!;
    assert.ok(subject, 'subject region missing');
    assert.equal(subject.coverage, 0.37);
    assert.equal(subject.sampled, (w / 2) * h);

    const expected = srgb255ToOklch(...left);
    assert.ok(Math.abs(subject.L.mean - expected.L) < 1e-9, `L.mean ${subject.L.mean} vs left ${expected.L}`);
    assert.ok(Math.abs(subject.C.mean - expected.C) < 1e-9, `C.mean ${subject.C.mean} vs left ${expected.C}`);
  });

  it('omits a region whose mask matches essentially no pixels, rather than reporting it empty', () => {
    const w = 16, h = 16;
    const img = solidImage(w, h, [128, 60, 30]);
    const emptyMask = buildMask(w, h, () => false);
    const masks = masksOf(w, h, { subject: emptyMask }, { subject: 0.5 });

    const { regions } = measureRegionsFromPixels(img, masks);
    assert.equal('subject' in regions, false, 'subject should be entirely absent, not present-but-empty');
  });

  it('concentrates hslBands weight in the one band nearest a saturated colour', () => {
    const rgb: Rgb = [225, 70, 45]; // saturated, warm
    const { H } = srgb255ToOklch(...rgb);
    const expectedKey = nearestBandKey(H);

    const img = solidImage(30, 30, rgb);
    const { hslBands } = measureRegionsFromPixels(img, NO_MASKS());
    assert.equal(hslBands.length, HSL_BANDS.length);
    assert.deepEqual(hslBands.map((b) => b.key), HSL_BANDS.map((b) => b.key));

    for (const band of hslBands) {
      if (band.key === expectedKey) {
        assert.ok(Math.abs(band.weight - 1) < 1e-9, `${band.key} weight was ${band.weight}, expected ~1`);
      } else {
        assert.equal(band.weight, 0, `${band.key} should have carried no weight`);
      }
    }
  });

  it('shows zero weight in every hsl band on a fully achromatic image', () => {
    const img = solidImage(20, 20, [140, 140, 140]);
    const { hslBands } = measureRegionsFromPixels(img, NO_MASKS());
    for (const band of hslBands) {
      assert.equal(band.weight, 0, `${band.key} weight was ${band.weight}`);
      assert.equal(band.chroma, 0, `${band.key} chroma was ${band.chroma}`);
      assert.equal(band.L, 0, `${band.key} L was ${band.L}`);
    }
  });
});

/* ── measureVignetteFromPixels ────────────────────────────────────────────── */

describe('measureVignetteFromPixels', () => {
  it('reports ~zero falloff and ~full symmetry on a perfectly flat field', () => {
    const img = solidImage(128, 128, [160, 160, 160]);
    const v = measureVignetteFromPixels(img);
    assert.ok(Math.abs(v.falloffStops) < 1e-9, `falloffStops was ${v.falloffStops}`);
    // cv is exactly 0 when every quadrant reads identically, so symmetry
    // saturates at exactly exp(0) = 1 rather than merely approaching it.
    assert.ok(Math.abs(v.symmetry - 1) < 1e-9, `symmetry was ${v.symmetry}`);
    assert.equal(v.usable, true);
  });

  it('reports negative falloff and high symmetry for a genuine, radially-even vignette', () => {
    const img = radialImage(128, 220, 40); // bright centre, dark ring, all corners equal
    const v = measureVignetteFromPixels(img);
    assert.ok(v.falloffStops < -0.5, `falloffStops was ${v.falloffStops}, expected clearly negative`);
    assert.ok(v.symmetry > 0.9, `symmetry was ${v.symmetry}, expected near 1 for four matching corners`);
    assert.equal(v.usable, true);
  });

  it('reports low symmetry and usable:false for a dark corner that is scene content, not optics', () => {
    const img = oneCornerDarkImage(128, 220, 10); // one dark corner, three bright
    const v = measureVignetteFromPixels(img);
    assert.ok(v.symmetry < VIGNETTE_MIN_SYMMETRY, `symmetry was ${v.symmetry}, expected below the gate`);
    assert.equal(v.usable, false);
  });
});
