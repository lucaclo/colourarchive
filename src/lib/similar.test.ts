/**
 * Tests for visual similarity ranking.
 *
 * `resemble.ts` (see its own tests) must rank on the *edit* and be blind to
 * the *subject* — this file is close to the mirror image of that one. Here
 * the two axes are drawn the other way around: `comp` reads subject and
 * structure (embedding, tonal layout, orientation) and must be blind to
 * colour it doesn't read; `col` reads colour and must be blind to
 * composition it doesn't read. Nothing here is compared against a curated
 * "correct" ranking — the properties that matter are the two axes staying
 * genuinely independent, the two very different missing-data conventions
 * (embedding falls back to *maximally far*, colourGrid falls back to *no
 * signal*) not bleeding into each other, and the min-max normalisation
 * behaving at its edges (one candidate, an empty list, a tie).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { rankSimilar } from './similar.ts';
import type { Photo } from './types.ts';
import type { OKLCH } from './color.ts';

/* ── Fixtures ──────────────────────────────────────────────────────────────── */

const NEUTRAL: OKLCH = { L: 0.5, C: 0.1, H: 0 };

/** Flattened 16-cell OKLab grid (4x4 colour-layout grid): the same [L,a,b] triple in every cell. */
const grid = (L: number, a: number, b: number): number[] =>
  Array.from({ length: 16 }, () => [L, a, b]).flat();

interface Spec {
  id?: string;
  embedding?: number[];
  colourGrid?: number[];
  oklch?: OKLCH;
  width?: number;
  height?: number;
}

let n = 0;
/** A Photo with only the fields rankSimilar reads; everything else the interface
 *  demands (filename, derivatives, exif, ...) is irrelevant to this function. */
const photo = (spec: Spec = {}): Photo =>
  ({
    id: spec.id ?? `p${n++}`,
    width: spec.width ?? 100,
    height: spec.height ?? 100,
    oklch: spec.oklch ?? NEUTRAL,
    embedding: spec.embedding,
    colourGrid: spec.colourGrid,
  } as unknown as Photo);

/* ── Normalisation edges ──────────────────────────────────────────────────── */

describe('rankSimilar — normalisation edges', () => {
  it('copes with an empty candidate list', () => {
    const ref = photo();
    assert.deepEqual(rankSimilar(ref, []), []);
  });

  it('places a single candidate at 0 on both axes (the ÷0 guard is well-defined, not NaN)', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0.2, 0.2) });
    const only = photo({ embedding: [0, 1, 0], colourGrid: grid(0.9, -0.2, 0.1), oklch: { L: 0.1, C: 0.3, H: 300 } });
    const [row] = rankSimilar(ref, [only]);
    assert.equal(row.comp, 0);
    assert.equal(row.col, 0);
    assert.ok(!Number.isNaN(row.comp) && !Number.isNaN(row.col));
  });

  it('each axis is independently min-max normalised — the two axes need not agree on which candidate is closest', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0), oklch: NEUTRAL, width: 100, height: 100 });
    // Matches ref on composition (same embedding, same tonal layout, same aspect)
    // but is thrown far away in colour (different colour layout, different dominant colour).
    const compClose = photo({
      embedding: [1, 0, 0],
      colourGrid: grid(0.5, 0.4, 0.4), // same L (tone) as ref, different a/b (colour layout)
      oklch: { L: 0.9, C: 0.3, H: 200 },
      width: 100,
      height: 100,
    });
    // Matches ref on colour (same colour layout, same dominant colour) but is
    // thrown far away in composition (orthogonal embedding, different tone, wild aspect).
    const colClose = photo({
      embedding: [0, 1, 0],
      colourGrid: grid(0.9, 0, 0), // different L (tone), same a/b (colour layout) as ref
      oklch: NEUTRAL,
      width: 200,
      height: 50,
    });
    const [rowCompClose, rowColClose] = rankSimilar(ref, [compClose, colClose]);
    assert.equal(rowCompClose.comp, 0);
    assert.equal(rowCompClose.col, 1);
    assert.equal(rowColClose.col, 0);
    assert.equal(rowColClose.comp, 1);
  });
});

/* ── Embedding: missing/mismatched falls back to maximally far ──────────────── */

describe('rankSimilar — embedding fallback', () => {
  it('treats a missing embedding, a length-mismatched embedding, and an exactly opposite one as equally (maximally) far', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0) });
    const identical = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0) });
    // cos-similarity -1 => embDist = 1 - (-1) = 2, the true ceiling of "1 - dot".
    const opposite = photo({ embedding: [-1, 0, 0], colourGrid: grid(0.5, 0, 0) });
    const missing = photo({ embedding: undefined, colourGrid: grid(0.5, 0, 0) });
    const mismatchedLength = photo({ embedding: [1, 0], colourGrid: grid(0.5, 0, 0) });

    const rows = rankSimilar(ref, [identical, opposite, missing, mismatchedLength]);
    const [rIdentical, rOpposite, rMissing, rMismatched] = rows;

    assert.equal(rIdentical.comp, 0);
    // All three "no usable embedding signal" cases tie with a genuinely
    // opposite embedding at the top of the range.
    assert.equal(rOpposite.comp, 1);
    assert.equal(rMissing.comp, 1);
    assert.equal(rMismatched.comp, 1);
  });
});

/* ── colourGrid: missing/mismatched falls back to no signal (0), NOT max ────── */

describe('rankSimilar — colourGrid fallback', () => {
  it('treats a missing or length-mismatched colourGrid as agreeing with the reference, the opposite convention from embedding', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0.3, 0.3), oklch: NEUTRAL });
    const same = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0.3, 0.3), oklch: NEUTRAL });
    const missing = photo({ embedding: [1, 0, 0], colourGrid: undefined, oklch: NEUTRAL });
    const mismatchedLength = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0.3, 0.3).slice(0, 6), oklch: NEUTRAL });
    // A genuinely different, same-length grid, present as a control so the
    // 0s above aren't a degenerate all-tied case.
    const different = photo({ embedding: [1, 0, 0], colourGrid: grid(0.9, 0.4, 0.4), oklch: NEUTRAL });

    const [rSame, rMissing, rMismatched, rDifferent] = rankSimilar(ref, [same, missing, mismatchedLength, different]);

    // "No signal" reads as a match (0), not as maximally different (which
    // would have tied these with `different` at 1) — an asymmetry from the
    // embedding fallback worth pinning down explicitly.
    assert.equal(rSame.col, 0);
    assert.equal(rMissing.col, 0);
    assert.equal(rMismatched.col, 0);
    assert.equal(rDifferent.col, 1);

    // The same fallback (toneDist = 0) also feeds the composition axis.
    assert.equal(rSame.comp, 0);
    assert.equal(rMissing.comp, 0);
    assert.equal(rMismatched.comp, 0);
    assert.equal(rDifferent.comp, 1);
  });
});

/* ── Axis blindness: comp and col each read a disjoint set of fields ────────── */

describe('rankSimilar — axis blindness', () => {
  it('col is blind to composition: identical oklch/colourGrid but wildly different embedding and aspect ratio give identical colRaw', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0.2, -0.1), oklch: { L: 0.6, C: 0.15, H: 90 } });
    const sameColourA = photo({
      embedding: [1, 0, 0],
      colourGrid: grid(0.4, 0.35, 0.1),
      oklch: { L: 0.2, C: 0.25, H: 10 },
      width: 100,
      height: 100,
    });
    const sameColourB = photo({
      embedding: [0, -1, 0], // wildly different embedding
      colourGrid: grid(0.4, 0.35, 0.1), // same colour grid as sameColourA
      oklch: { L: 0.2, C: 0.25, H: 10 }, // same dominant colour as sameColourA
      width: 400,
      height: 30, // wildly different aspect ratio
    });
    const [rowA, rowB] = rankSimilar(ref, [sameColourA, sameColourB]);
    assert.equal(rowA.col, rowB.col);
    assert.notEqual(rowA.comp, rowB.comp);
  });

  it('comp is blind to colour: identical embedding/tonal-layout/aspect but different colour layout and dominant colour give identical compRaw', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0), oklch: NEUTRAL, width: 100, height: 100 });
    const sameCompA = photo({
      embedding: [0.7, 0.7, 0],
      colourGrid: grid(0.3, 0.1, 0.1), // L=0.3, a/b=0.1
      oklch: { L: 0.9, C: 0.2, H: 40 },
      width: 200,
      height: 100,
    });
    const sameCompB = photo({
      embedding: [0.7, 0.7, 0], // same embedding as sameCompA
      colourGrid: grid(0.3, 0.9, -0.6), // same L (tone) as sameCompA, wildly different a/b
      oklch: { L: 0.05, C: 0.3, H: 260 }, // wildly different dominant colour
      width: 200,
      height: 100, // same aspect as sameCompA
    });
    const [rowA, rowB] = rankSimilar(ref, [sameCompA, sameCompB]);
    assert.equal(rowA.comp, rowB.comp);
    assert.notEqual(rowA.col, rowB.col);
  });
});

/* ── Aspect ratio distance: log-symmetric under inversion ───────────────────── */

describe('rankSimilar — aspect ratio', () => {
  it('a photo half as wide as tall and one twice as wide as tall are equidistant from a square reference', () => {
    const ref = photo({ embedding: [1, 0, 0], colourGrid: undefined, width: 100, height: 100 });
    const square = photo({ embedding: [1, 0, 0], colourGrid: undefined, width: 100, height: 100 }); // ratio 1, anchor
    const tall = photo({ embedding: [1, 0, 0], colourGrid: undefined, width: 50, height: 100 }); // ratio 2
    const wide = photo({ embedding: [1, 0, 0], colourGrid: undefined, width: 100, height: 50 }); // ratio 0.5

    const [rSquare, rTall, rWide] = rankSimilar(ref, [square, tall, wide]);
    assert.equal(rSquare.comp, 0);
    // |log(2)| === |log(0.5)|, so tall and wide tie for furthest.
    assert.equal(rTall.comp, 1);
    assert.equal(rWide.comp, 1);
  });
});

/* ── Order and identity ───────────────────────────────────────────────────── */

describe('rankSimilar — order and identity', () => {
  it('returns one row per candidate, in the given order, carrying the original candidate object', () => {
    const ref = photo({ id: 'ref' });
    const a = photo({ id: 'a' });
    const b = photo({ id: 'b' });
    const c = photo({ id: 'c' });
    const rows = rankSimilar(ref, [c, a, b]);
    assert.deepEqual(rows.map((r) => r.photo.id), ['c', 'a', 'b']);
    assert.equal(rows[0].photo, c);
    assert.equal(rows[1].photo, a);
    assert.equal(rows[2].photo, b);
  });

  it('does not filter the reference out — it appears in the output if explicitly passed as a candidate', () => {
    const ref = photo({ id: 'ref' });
    const other = photo({ id: 'other' });
    const rows = rankSimilar(ref, [other, ref]);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].photo, ref);
  });
});
