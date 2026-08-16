/**
 * Tests for greyscale erosion.
 *
 * `erode` exists so a mask can be shrunk inward without dragging in sharp or a
 * model — the whole point is that it is pure and separable: one O(n) sliding
 * window run over rows, then the same run over columns, standing in for an
 * O(w·h·r²) box-minimum. That equivalence is the property most worth proving
 * here, because it is the one thing that could silently drift — a bug in the
 * separable version would still "look like" erosion on most masks, just not
 * the *same* erosion a naive box-min would produce. So most of these tests
 * check the fast path against a naive reference on small, fixed masks rather
 * than asserting hand-computed numbers throughout.
 *
 * A second thing worth proving: this is *greyscale* erosion, not binary. The
 * doc comment on `erode` says soft, anti-aliased masks "erode correctly too,
 * since greyscale erosion is just a local minimum" — so a test constructs a
 * mid-value gradient and checks the output is the local minimum, not the
 * nearest of 0/255.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { erode } from './morphology.ts';

/* ── Reference implementation ─────────────────────────────────────────────── */

/**
 * Naive O(w·h·r²) box-minimum erosion: for every pixel, the minimum value in
 * the Chebyshev (square) neighbourhood of the given radius, clipped at the
 * borders rather than wrapped or padded. This is what the separable deque
 * version is a fast substitute for, so it doubles as the spec.
 */
function naiveErode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius < 1) return mask.slice();
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let min = 255;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const v = mask[ny * width + nx];
          if (v < min) min = v;
        }
      }
      out[y * width + x] = min;
    }
  }
  return out;
}

/** A tiny seeded PRNG (mulberry32) so masks are pseudo-random but reproducible. */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMask(width: number, height: number, seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.floor(rand() * 256);
  return mask;
}

/* ── Fixed random masks, so the separable/naive comparison is deterministic ── */

const RANDOM_CASES: Array<{ width: number; height: number; seed: number }> = [
  { width: 5, height: 5, seed: 1 },
  { width: 7, height: 3, seed: 2 },
  { width: 1, height: 9, seed: 3 },
  { width: 9, height: 1, seed: 4 },
  { width: 11, height: 8, seed: 5 },
];

describe('erode', () => {
  it('returns the input untouched, by reference, when radius < 1', () => {
    // The short-circuit in the code returns `mask` itself, not a copy — a
    // caller that mutates the result would be mutating the source mask too.
    // That is worth pinning down explicitly rather than leaving it implicit.
    const mask = new Uint8Array([1, 2, 3, 4]);
    assert.equal(erode(mask, 2, 2, 0), mask);
    assert.equal(erode(mask, 2, 2, -1), mask);
  });

  it('leaves a uniform mask unchanged at any radius', () => {
    const mask = new Uint8Array(6 * 6).fill(77);
    for (const radius of [1, 2, 3, 10]) {
      assert.deepEqual(erode(mask, 6, 6, radius), mask);
    }
  });

  it('always returns width × height values', () => {
    for (const { width, height, seed } of RANDOM_CASES) {
      for (const radius of [1, 2, 4]) {
        const out = erode(randomMask(width, height, seed), width, height, radius);
        assert.equal(out.length, width * height);
      }
    }
  });

  it('shrinks a bright island to its centre once the radius reaches its half-width', () => {
    // A 3×3 block of 255 in a field of 0, on a 7×7 canvas so the block does
    // not touch the border. At radius 1 the structuring element (3×3) fits
    // entirely inside the island only at its centre pixel — everywhere else
    // the window spills into the surrounding 0. At radius 2 the window (5×5)
    // no longer fits inside the 3×3 island anywhere, so the island vanishes.
    const width = 7;
    const height = 7;
    const mask = new Uint8Array(width * height);
    for (let y = 2; y <= 4; y++) {
      for (let x = 2; x <= 4; x++) mask[y * width + x] = 255;
    }

    const r1 = erode(mask, width, height, 1);
    const bright1 = [...r1].reduce((n, v, i) => (v === 255 ? [...n, i] : n), [] as number[]);
    assert.deepEqual(bright1, [3 * width + 3]); // only the centre pixel survives

    const r2 = erode(mask, width, height, 2);
    assert.ok(r2.every((v) => v === 0), 'the island should be gone entirely at radius 2');
  });

  it('erodes a mid-value gradient to its local minimum, not the nearest of 0/255', () => {
    // A "V" of soft values, height 1 so the horizontal pass alone is under
    // test. Greyscale erosion at radius 1 is the min of each 3-wide window
    // (2-wide at the borders) — computed here without rounding to black/white.
    const width = 9;
    const height = 1;
    const values = [200, 150, 100, 50, 0, 50, 100, 150, 200];
    const mask = new Uint8Array(values);
    const out = erode(mask, width, height, 1);
    assert.deepEqual([...out], [150, 100, 50, 0, 0, 0, 50, 100, 150]);
  });

  it('matches a naive Chebyshev box-minimum reference on small fixed masks', () => {
    // This is the property the whole file exists to guarantee: doing the
    // minimum-filter horizontally then vertically is only valid because
    // greyscale erosion with a square structuring element is separable.
    for (const { width, height, seed } of RANDOM_CASES) {
      const mask = randomMask(width, height, seed);
      for (const radius of [1, 2, 3, 5]) {
        const fast = erode(mask, width, height, radius);
        const naive = naiveErode(mask, width, height, radius);
        assert.deepEqual([...fast], [...naive], `mismatch at ${width}x${height} r=${radius} seed=${seed}`);
      }
    }
  });

  it('never grows: a window clipped at the border still only shrinks the mask', () => {
    // Border pixels have a smaller window rather than one that wraps around
    // or is padded with an assumed value, so their eroded value can still
    // only be less than or equal to the original — never something the
    // original mask never contained.
    for (const { width, height, seed } of RANDOM_CASES) {
      const mask = randomMask(width, height, seed);
      const out = erode(mask, width, height, 2);
      for (let i = 0; i < mask.length; i++) {
        assert.ok(out[i] <= mask[i], `pixel ${i} grew: ${mask[i]} -> ${out[i]}`);
      }
    }
  });

  it('is monotonic in radius: a larger radius never raises any pixel', () => {
    for (const { width, height, seed } of RANDOM_CASES) {
      const mask = randomMask(width, height, seed);
      const radii = [1, 2, 3, 4, 6];
      let previous = mask;
      for (const radius of radii) {
        const out = erode(mask, width, height, radius);
        for (let i = 0; i < out.length; i++) {
          assert.ok(
            out[i] <= previous[i],
            `radius ${radius} raised pixel ${i}: ${previous[i]} -> ${out[i]}`,
          );
        }
        previous = out;
      }
    }
  });
});
