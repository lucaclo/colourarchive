/**
 * Tests for the pure half of texture measurement.
 *
 * texture-core.ts never touches a file — it takes luminance arrays it is
 * handed and turns them into grain/acutance numbers, or refuses to. That
 * split matters here: the interesting property of a Sobel-and-box-blur
 * pipeline like this one is almost never an exact constant (the maths shifts
 * if a threshold moves half a percent) but a *direction* — noisier input
 * reads noisier, a sharper edge reads sharper, too little data refuses
 * rather than guesses. So most of what follows compares constructed crops
 * against each other rather than pinning magic numbers, the same way
 * resemble.test.ts compares grades rather than pinning distances.
 *
 * The one exception is the honesty gates in `measureTextureFrom`: those
 * *are* exact thresholds, by design (see `blockedTexture`'s four reasons in
 * types.ts), so the four outcomes get built and pinned directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROP,
  TEXTURE_NORM_EDGE,
  TEXTURE_SCALE_TOLERANCE,
  blockedTexture,
  cropOrigin,
  FULL_GRID,
  SPREAD_GRID,
  measureCrop,
  measureTextureFrom,
  median,
  textureComparable,
  toLuma,
  type CropSampler,
  type TextureSource,
} from './texture-core.ts';
import type { TextureStats } from './types.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

/** A tiny deterministic PRNG so noise fixtures are reproducible without
 *  pulling in a dependency — same idea as resemble.test.ts's `region()`,
 *  just for pixels instead of regions. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** Uniform crop — no texture at all. */
function flatCrop(value = 128, w = CROP, h = CROP): Float32Array {
  return new Float32Array(w * h).fill(value);
}

/** White noise around mid-grey. `amp` is peak-to-peak in luma units. */
function noiseCrop(amp: number, seed = 1, w = CROP, h = CROP): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = 128 + (r() - 0.5) * amp;
  return out;
}

/** Maximum-frequency alternating pattern — as textured as a crop can be. */
function checkerCrop(w = CROP, h = CROP): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (x + y) % 2 === 0 ? 0 : 255;
  return out;
}

/** Smooth linear ramp — has a slope (so it is not flat) but no noise. */
function rampCrop(w = CROP, h = CROP): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = (x / w) * 255;
  return out;
}

/** Barely-there detail: a low-frequency wobble a few tenths of a luma level
 *  deep, the shape a genuinely upscaled photograph's residual high
 *  frequencies take (some structure survives resampling, but not enough to
 *  be real detail). */
function faintCrop(seed = 1, w = CROP, h = CROP): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = 128 + 1.5 * Math.sin((2 * Math.PI * x) / 16) + (r() - 0.5) * 0.3;
  }
  return out;
}

/** A within-block-smooth, across-block-stepped pattern — the shape JPEG
 *  blocking leaves behind: real activity inside each 8px column, plus an
 *  extra jump exactly at every 8px boundary that has nothing to do with the
 *  scene. */
function blockyCrop(seed = 1, w = CROP, h = CROP): Float32Array {
  const r = rng(seed);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const step = (Math.floor(x / 8) % 2) * 8;
      out[y * w + x] = 128 + step + (r() - 0.5) * 15;
    }
  }
  return out;
}

const textureStats = (overrides: Partial<TextureStats> = {}): TextureStats => ({
  usable: true,
  blocked: 'none',
  normalised: false,
  nativeSize: { width: 2400, height: 1600 },
  grain: 0.01,
  grainSize: 2,
  acutance: 0.05,
  flatToEdge: 0.5,
  measuredAt: { width: 2400, height: 1600 },
  ...overrides,
});

/** A sampler that hands back the same synthetic crop for every position,
 *  regardless of where it was asked to look — texture-core only cares that
 *  a crop comes back, not where it came from. */
function samplerOf(make: (left: number, top: number) => Float32Array, w = CROP, h = CROP): CropSampler {
  return async (left, top) => ({ luma: make(left, top), width: w, height: h });
}

function sourceOf(
  overrides: Partial<TextureSource> & { nativeWidth: number; nativeHeight: number; sampleNative: CropSampler },
): TextureSource {
  return { normalised: null, ...overrides };
}

/* ── median ────────────────────────────────────────────────────────────────── */

describe('median', () => {
  it('is the middle value of an odd-length array', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([5]), 5);
  });

  it('averages the two middle values of an even-length array', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([1, 3]), 2);
  });

  it('does not require its input pre-sorted', () => {
    assert.equal(median([9, 1, 5, 3, 7]), 5);
  });

  it('returns 0 for an empty array rather than NaN or throwing', () => {
    // Callers (measureTextureFrom) feed this the results of a grid of crops
    // that may all have been skipped; a throw there would take down the
    // whole measurement over what is really just "no data".
    assert.equal(median([]), 0);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    assert.deepEqual(xs, [3, 1, 2]);
  });
});

/* ── toLuma ────────────────────────────────────────────────────────────────── */

describe('toLuma', () => {
  it('leaves neutral grey unchanged', () => {
    const data = new Uint8Array([128, 128, 128, 128, 128, 128]);
    assert.deepEqual(Array.from(toLuma(data, 2, 3)), [128, 128]);
  });

  it('puts pure white and pure black at opposite ends', () => {
    const white = new Uint8Array([255, 255, 255]);
    const black = new Uint8Array([0, 0, 0]);
    assert.equal(toLuma(white, 1, 3)[0], 255);
    assert.equal(toLuma(black, 1, 3)[0], 0);
  });

  it('weights channels by Rec.709, not an equal average', () => {
    // Isolating each channel reads off the coefficients directly: an equal
    // average would put all three at 255/3 = 85.
    const [r, g, b] = [
      toLuma(new Uint8Array([255, 0, 0]), 1, 3)[0],
      toLuma(new Uint8Array([0, 255, 0]), 1, 3)[0],
      toLuma(new Uint8Array([0, 0, 255]), 1, 3)[0],
    ];
    assert.ok(Math.abs(r - 0.2126 * 255) < 1e-4, `red weight: got ${r}`);
    assert.ok(Math.abs(g - 0.7152 * 255) < 1e-4, `green weight: got ${g}`);
    assert.ok(Math.abs(b - 0.0722 * 255) < 1e-4, `blue weight: got ${b}`);
    assert.ok(g > r && r > b, 'Rec.709 orders green > red > blue');
  });

  it('ignores the fourth channel of RGBA input', () => {
    // It's "toLuma", not "toLumaWithAlpha" — a bogus/garbage alpha byte must
    // not move the result at all.
    const rgb = new Uint8Array([10, 20, 30, 200, 150, 100]);
    const rgba = new Uint8Array([10, 20, 30, 0, 200, 150, 100, 255]);
    assert.deepEqual(Array.from(toLuma(rgb, 2, 3)), Array.from(toLuma(rgba, 2, 4)));
  });
});

/* ── measureCrop ───────────────────────────────────────────────────────────── */

describe('measureCrop', () => {
  it('refuses crops with no interior pixels to sample', () => {
    // The gradient loop runs over [1, w-1) x [1, h-1); at 1x1 or 2x2 that
    // range is empty, so there is nothing to build a histogram from.
    assert.equal(measureCrop(new Float32Array([100]), 1, 1), null);
    assert.equal(measureCrop(flatCrop(100, 2, 2), 2, 2), null);
  });

  it('refuses a perfectly flat crop even at full size', () => {
    // This is the least obvious guard in the file: a completely uniform
    // CROPxCROP crop is not "very low grain", it is null. With zero gradient
    // everywhere, every pixel lands in histogram bin 0, so both the 35th and
    // 85th percentile thresholds resolve to that same bin, the "edge" bucket
    // (g >= edgeMin) never separates from the "flat" bucket (g <= flatMax),
    // and edgeN stays 0 — which trips the explicit null guard. A flat image
    // reads as "cannot measure", not "grain zero".
    assert.equal(measureCrop(flatCrop(128), CROP, CROP), null);
  });

  it('reads grain and acutance higher as the crop gets busier', () => {
    // Three crops in increasing order of high-frequency content. The ramp
    // has a slope but no per-pixel noise; the noise crop has real
    // pixel-to-pixel variation; the checkerboard is the most extreme
    // pattern representable at all. grainRms and acutance should climb in
    // that order regardless of the exact constants inside the pipeline.
    const ramp = measureCrop(rampCrop(), CROP, CROP)!;
    const noisy = measureCrop(noiseCrop(40), CROP, CROP)!;
    const checker = measureCrop(checkerCrop(), CROP, CROP)!;
    assert.ok(ramp && noisy && checker, 'all three crops should be measurable');

    assert.ok(ramp.grainRms < noisy.grainRms, `ramp grain ${ramp.grainRms} should be < noisy ${noisy.grainRms}`);
    assert.ok(noisy.grainRms < checker.grainRms, `noisy grain ${noisy.grainRms} should be < checker ${checker.grainRms}`);

    assert.ok(ramp.acutance < noisy.acutance, `ramp acutance ${ramp.acutance} should be < noisy ${noisy.acutance}`);
    assert.ok(noisy.acutance < checker.acutance, `noisy acutance ${noisy.acutance} should be < checker ${checker.acutance}`);
  });

  it('reports every field finite and non-negative on a normal crop', () => {
    const m = measureCrop(noiseCrop(30), CROP, CROP)!;
    for (const [key, value] of Object.entries(m)) {
      assert.ok(Number.isFinite(value), `${key} was not finite: ${value}`);
      assert.ok(value >= 0, `${key} was negative: ${value}`);
    }
  });

  it('reports blockiness near neutral on a crop too quiet to judge', () => {
    // BLOCKINESS_ACTIVITY_FLOOR: when there is almost no within-block
    // activity to divide by, the ratio would explode and falsely read as
    // heavy compression. The faint crop (a fraction of a luma level of
    // wobble) is exactly that case, and the function reports the documented
    // neutral value of 1 rather than a spurious high ratio.
    const m = measureCrop(faintCrop(), CROP, CROP)!;
    assert.ok(m, 'faint crop should still be measurable');
    assert.equal(m.blockiness, 1);
  });

  it('reads much higher blockiness on a crop with an artificial 8px step', () => {
    // Same within-block noise amplitude as a plain noisy crop, but with an
    // extra discontinuity planted at every 8th column — the DCT block
    // boundary. blockiness should read far higher than an equivalent crop
    // with no such step, and clear the (unexported, but empirically located
    // — see the measureTextureFrom 'compression' case below) threshold the
    // pipeline actually gates on, while the plain crop stays near neutral.
    const plain = measureCrop(noiseCrop(15, 7), CROP, CROP)!;
    const stepped = measureCrop(blockyCrop(7), CROP, CROP)!;
    assert.ok(plain.blockiness < 1.1, `plain blockiness should read near neutral: ${plain.blockiness}`);
    assert.ok(stepped.blockiness > 1.5, `stepped blockiness should read clearly elevated: ${stepped.blockiness}`);
    assert.ok(stepped.blockiness > plain.blockiness * 1.5, `stepped ${stepped.blockiness} vs plain ${plain.blockiness}`);
  });
});

/* ── textureComparable ─────────────────────────────────────────────────────── */

describe('textureComparable', () => {
  it('allows two measurements at the same size', () => {
    assert.equal(textureComparable(textureStats(), textureStats()), true);
  });

  it('honours TEXTURE_SCALE_TOLERANCE as an inclusive boundary', () => {
    const a = textureStats({ measuredAt: { width: 2400, height: 1600 } });
    const atLimit = 2400 * (1 - TEXTURE_SCALE_TOLERANCE);
    const overLimit = atLimit - 1;
    const b = textureStats({ measuredAt: { width: atLimit, height: 1600 } });
    const c = textureStats({ measuredAt: { width: overLimit, height: 1600 } });
    assert.equal(textureComparable(a, b), true);
    assert.equal(textureComparable(a, c), false);
  });

  it('refuses when either side is unusable', () => {
    const usable = textureStats();
    const blocked = textureStats({ usable: false });
    assert.equal(textureComparable(usable, blocked), false);
    assert.equal(textureComparable(blocked, usable), false);
  });

  it('is symmetric', () => {
    const a = textureStats({ measuredAt: { width: 2400, height: 1600 } });
    const b = textureStats({ measuredAt: { width: 2100, height: 1400 } });
    assert.equal(textureComparable(a, b), textureComparable(b, a));
  });
});

/* ── cropOrigin ────────────────────────────────────────────────────────────── */

describe('cropOrigin', () => {
  it('refuses an image with no room for the 8% inset plus a full crop', () => {
    // At exactly CROP pixels there is zero span left once the 8% edge inset
    // is taken from both sides, let alone room for a CROPxCROP window.
    assert.equal(cropOrigin(CROP, CROP, 0, 0), null);
    // Comfortably too small: same story.
    assert.equal(cropOrigin(200, 200, 0, 0), null);
  });

  it('keeps every grid position inside [0, size - CROP] and 8-aligned', () => {
    for (const size of [300, 500, 1000, 3000]) {
      for (const [gx, gy] of FULL_GRID) {
        const origin = cropOrigin(size, size, gx, gy);
        assert.ok(origin, `grid (${gx},${gy}) at size ${size} should be samplable`);
        assert.ok(origin!.left >= 0 && origin!.left + CROP <= size, `left ${origin!.left} out of bounds at ${size}`);
        assert.ok(origin!.top >= 0 && origin!.top + CROP <= size, `top ${origin!.top} out of bounds at ${size}`);
        assert.equal(origin!.left % 8, 0, `left ${origin!.left} not 8-aligned`);
        assert.equal(origin!.top % 8, 0, `top ${origin!.top} not 8-aligned`);
      }
    }
  });

  it('spreads left-to-right as gx increases, on a large image', () => {
    const size = 3000;
    const lefts = [0, 1, 2, 3].map((gx) => cropOrigin(size, size, gx, 0)!.left);
    for (let i = 1; i < lefts.length; i++) assert.ok(lefts[i] > lefts[i - 1], `origins did not spread: ${lefts}`);
  });

  it('collapses every grid position to the same origin when there is almost no span', () => {
    // Just above the minimum viable size, the 8%-inset span is only a
    // handful of pixels — not enough to place four distinct columns, so
    // every gx rounds to the same 8-aligned origin. Not a bug: there is
    // nowhere else for the crop to go.
    const size = 229;
    const origins = FULL_GRID.map(([gx, gy]) => cropOrigin(size, size, gx, gy));
    assert.ok(origins.every((o) => o !== null), 'all positions should still be samplable');
    const unique = new Set(origins.map((o) => `${o!.left},${o!.top}`));
    assert.equal(unique.size, 1);
  });
});

/* ── blockedTexture ────────────────────────────────────────────────────────── */

describe('blockedTexture', () => {
  it('builds an unusable, zeroed-out result carrying the given reason', () => {
    const native = { width: 640, height: 480 };
    const result = blockedTexture('resolution', 'too small', native);
    assert.deepEqual(result, {
      usable: false,
      blocked: 'resolution',
      reason: 'too small',
      normalised: false,
      nativeSize: native,
      grain: 0,
      grainSize: 0,
      acutance: 0,
      flatToEdge: 0,
      measuredAt: native,
    });
  });

  it('reports measuredAt as the native size, never a normalised one', () => {
    const native = { width: 640, height: 480 };
    const result = blockedTexture('compression', 'x', native);
    assert.deepEqual(result.measuredAt, native);
    assert.equal(result.normalised, false);
  });
});

/* ── measureTextureFrom ────────────────────────────────────────────────────── */

describe('measureTextureFrom', () => {
  it('blocks on resolution when the source is too small, without sampling it', () => {
    let sampled = false;
    const src = sourceOf({
      nativeWidth: 800,
      nativeHeight: 600,
      sampleNative: async () => {
        sampled = true;
        return null;
      },
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, false);
      assert.equal(stats.blocked, 'resolution');
      assert.equal(sampled, false, 'a too-small source should be rejected before any crop is taken');
    });
  });

  it('blocks on resolution when a large-enough source cannot yield usable crops', () => {
    // A perfectly flat source at ample native resolution: measureCrop
    // refuses every single crop (see the measureCrop suite above), so the
    // grid comes back empty. That is reported as a resolution/sampling
    // failure, not as "flat = no grain" — the gate has no way to tell "no
    // data" apart from "no texture" and correctly declines to guess.
    const src = sourceOf({
      nativeWidth: 3000,
      nativeHeight: 2000,
      sampleNative: samplerOf(() => flatCrop(128)),
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, false);
      assert.equal(stats.blocked, 'resolution');
    });
  });

  it('blocks on compression when native crops carry an 8px-periodic step', () => {
    const src = sourceOf({
      nativeWidth: 3000,
      nativeHeight: 2000,
      sampleNative: samplerOf((left, top) => blockyCrop(left * 13 + top * 7 + 1)),
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, false);
      assert.equal(stats.blocked, 'compression');
    });
  });

  it('blocks on upscaled when there is real structure but almost no energy in it', () => {
    const src = sourceOf({
      nativeWidth: 3000,
      nativeHeight: 2000,
      sampleNative: samplerOf((left, top) => faintCrop(left * 13 + top * 7 + 1)),
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, false);
      assert.equal(stats.blocked, 'upscaled');
    });
  });

  it('reads usable on an ordinary textured source, with grainSize kept in [1, 6]', () => {
    const src = sourceOf({
      nativeWidth: 3000,
      nativeHeight: 2000,
      sampleNative: samplerOf((left, top) => noiseCrop(40, left * 13 + top * 7 + 1)),
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, true);
      assert.equal(stats.blocked, 'none');
      assert.equal(stats.reason, undefined);
      assert.ok(stats.grain > 0);
      assert.ok(stats.acutance > 0);
      assert.ok(stats.grainSize >= 1 && stats.grainSize <= 6, `grainSize out of range: ${stats.grainSize}`);
      assert.equal(stats.normalised, false);
      assert.deepEqual(stats.measuredAt, { width: 3000, height: 2000 });
    });
  });

  it('measures at the normalised size and says so, when one is supplied', () => {
    const src = sourceOf({
      nativeWidth: 4000,
      nativeHeight: 3000,
      sampleNative: samplerOf((left, top) => noiseCrop(40, left * 13 + top * 7 + 1)),
      normalised: {
        width: 2400,
        height: 1800,
        sample: samplerOf((left, top) => noiseCrop(40, left * 17 + top * 11 + 99)),
      },
    });
    return measureTextureFrom(src).then((stats) => {
      assert.equal(stats.usable, true);
      assert.equal(stats.normalised, true);
      assert.deepEqual(stats.nativeSize, { width: 4000, height: 3000 });
      assert.deepEqual(stats.measuredAt, { width: 2400, height: 1800 });
    });
  });
});

/* ── Constants ─────────────────────────────────────────────────────────────── */

describe('constants', () => {
  it('keeps CROP on the JPEG DCT grid', () => {
    // The docstring on CROP is explicit about why: without 8-alignment the
    // blockiness test lines up with nothing.
    assert.equal(CROP % 8, 0);
  });

  it('keeps SPREAD_GRID inside FULL_GRID and covering more than one row', () => {
    // The comment on SPREAD_GRID explains the bug it avoids: sampling only
    // the first few positions of FULL_GRID would sample only the top row.
    const gys = new Set(SPREAD_GRID.map(([, gy]) => gy));
    assert.ok(gys.size > 1, 'SPREAD_GRID should not sit in a single row');
    for (const [gx, gy] of SPREAD_GRID) {
      assert.ok(FULL_GRID.some(([fx, fy]) => fx === gx && fy === gy), `(${gx},${gy}) is not a FULL_GRID position`);
    }
  });

  it('reports a sane normalisation edge and scale tolerance', () => {
    assert.ok(TEXTURE_NORM_EDGE > 0);
    assert.ok(TEXTURE_SCALE_TOLERANCE > 0 && TEXTURE_SCALE_TOLERANCE < 1);
  });
});
