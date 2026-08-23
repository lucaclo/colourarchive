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

import { groupColourDistances, groupOutliers, rankSimilar, rankSimilarGroup } from './similar.ts';
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

/* ── rankSimilarGroup ─────────────────────────────────────────────────────── */

describe('rankSimilarGroup — reduces to rankSimilar for one reference', () => {
  it('is bit-for-bit identical to rankSimilar, across varied fixtures', () => {
    const candidates = [
      photo({ embedding: [1, 0, 0], colourGrid: grid(0.4, 0.2, -0.1), oklch: { L: 0.3, C: 0.2, H: 40 } }),
      photo({ embedding: [0, 1, 0], colourGrid: grid(0.8, -0.3, 0.2), oklch: { L: 0.7, C: 0.1, H: 200 } }),
      photo({ embedding: undefined, colourGrid: undefined, oklch: NEUTRAL, width: 300, height: 100 }),
    ];
    for (const ref of [
      photo({ embedding: [0.6, 0.8, 0], colourGrid: grid(0.5, 0.1, 0.1), oklch: { L: 0.5, C: 0.15, H: 90 } }),
      photo({ embedding: undefined, colourGrid: undefined, oklch: NEUTRAL, width: 50, height: 200 }),
    ]) {
      assert.deepEqual(rankSimilarGroup([ref], candidates), rankSimilar(ref, candidates));
    }
  });
});

describe('rankSimilarGroup — composition: closest of the group, not a blend', () => {
  it('a candidate matching one reference exactly on composition beats one that matches neither', () => {
    const refA = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0), width: 100, height: 100 });
    const refB = photo({ embedding: [0, 1, 0], colourGrid: grid(0.5, 0, 0), width: 100, height: 100 });
    // Exactly refA's composition — a real point in embedding space.
    const matchesA = photo({ embedding: [1, 0, 0], colourGrid: grid(0.5, 0, 0), width: 100, height: 100 });
    // Halfway between the two embeddings — closer to what a naive average of
    // refA/refB would land on, and farther from *both* real references than
    // matchesA is from its one.
    const betweenBoth = photo({ embedding: [0.7071, 0.7071, 0], colourGrid: grid(0.5, 0, 0), width: 100, height: 100 });
    const [rowMatches, rowBetween] = rankSimilarGroup([refA, refB], [matchesA, betweenBoth]);
    assert.equal(rowMatches.comp, 0);
    assert.ok(rowBetween.comp > 0, `expected the blended point to rank worse, got ${rowBetween.comp}`);
  });
});

describe('rankSimilarGroup — colour: compared against the group centroid, not any one member', () => {
  it('a candidate at the shared centroid beats one that only matches a single off-centroid member', () => {
    // Three references whose a/b values are arranged to average to (0, 0) —
    // different colours individually, but a shared centroid.
    const refs = [
      photo({ colourGrid: grid(0.5, 0.1, 0), oklch: NEUTRAL }),
      photo({ colourGrid: grid(0.5, 0, 0.1), oklch: NEUTRAL }),
      photo({ colourGrid: grid(0.5, -0.1, -0.1), oklch: NEUTRAL }),
    ];
    const atCentroid = photo({ colourGrid: grid(0.5, 0, 0), oklch: NEUTRAL });
    // Exactly refs[0]'s colour — a real submitted colour, but off the group's centroid.
    const matchesOneRef = photo({ colourGrid: grid(0.5, 0.1, 0), oklch: NEUTRAL });
    const [rowCentroid, rowOneRef] = rankSimilarGroup(refs, [atCentroid, matchesOneRef]);
    assert.equal(rowCentroid.col, 0);
    assert.equal(rowOneRef.col, 1);
  });

  it('excludes refs with no colour grid from the centroid rather than averaging in a zero', () => {
    const withGrid = photo({ colourGrid: grid(0.5, 0.2, 0.2), oklch: NEUTRAL });
    const withoutGrid = photo({ colourGrid: undefined, oklch: NEUTRAL });
    // Matches the one real grid exactly — should win if the centroid is that
    // grid alone. A single-candidate check can't tell this apart from the
    // bug (min-max normalisation puts any lone candidate at 0 regardless of
    // its raw distance), so a second, contrasting candidate is the point:
    // matchesRealGrid vs matchesZeroedCentroid disagree on which wins
    // depending on whether the missing grid was excluded or averaged in as
    // a phantom (0, 0).
    const matchesRealGrid = photo({ colourGrid: grid(0.5, 0.2, 0.2), oklch: NEUTRAL });
    const matchesZeroedCentroid = photo({ colourGrid: grid(0.5, 0.1, 0.1), oklch: NEUTRAL });
    const [rowReal, rowZeroed] = rankSimilarGroup([withGrid, withoutGrid], [matchesRealGrid, matchesZeroedCentroid]);
    assert.equal(rowReal.col, 0);
    assert.equal(rowZeroed.col, 1);
  });

  it('still reduces to "no signal" when nothing in the group has a colour grid', () => {
    const refs = [photo({ colourGrid: undefined }), photo({ colourGrid: undefined })];
    const candidate = photo({ colourGrid: grid(0.9, 0.9, 0.9) });
    const [row] = rankSimilarGroup(refs, [candidate]);
    assert.equal(row.col, 0);
  });
});

describe('groupColourDistances / groupOutliers', () => {
  it('catches an outlier that a centroid including itself would dilute away', () => {
    // Two references that agree loosely, one that genuinely doesn't — sized
    // to real archive photos, not a clean synthetic swatch: a shared-centroid
    // measure (the first version of this, before it was measured against
    // real photos) rates the odd one out at 1.5x the group's mean here, just
    // under a 1.75x threshold. Leaving each reference out of its own
    // baseline is what actually catches it.
    const a = photo({ id: 'a', colourGrid: grid(0.5, 0.1, 0.1) });
    const b = photo({ id: 'b', colourGrid: grid(0.5, 0.12, 0.09) });
    const outlier = photo({ id: 'outlier', colourGrid: grid(0.5, 0.4, -0.3) });
    const flagged = groupOutliers([a, b, outlier]);
    assert.ok(flagged.has('outlier'), [...flagged].join(','));
    assert.equal(flagged.size, 1);
  });

  it('makes no assertion under three references with a colour grid — refuses to guess which of two is the outlier', () => {
    const a = photo({ id: 'a', colourGrid: grid(0.5, 0.9, 0.9) });
    const b = photo({ id: 'b', colourGrid: grid(0.5, -0.9, -0.9) });
    assert.equal(groupOutliers([a, b]).size, 0);
    assert.equal(groupOutliers([a]).size, 0);
    assert.equal(groupOutliers([]).size, 0);
  });

  it('flags a clear odd-one-out among a tight cluster', () => {
    const a = photo({ id: 'a', colourGrid: grid(0.5, 0.1, 0.1) });
    const b = photo({ id: 'b', colourGrid: grid(0.5, 0.12, 0.09) });
    const c = photo({ id: 'c', colourGrid: grid(0.5, 0.09, 0.11) });
    const outlier = photo({ id: 'outlier', colourGrid: grid(0.5, -0.8, 0.7) });
    const flagged = groupOutliers([a, b, c, outlier]);
    assert.ok(flagged.has('outlier'), [...flagged].join(','));
    assert.equal(flagged.size, 1);
  });

  it('flags nothing when the whole group is a tight cluster', () => {
    const a = photo({ id: 'a', colourGrid: grid(0.5, 0.1, 0.1) });
    const b = photo({ id: 'b', colourGrid: grid(0.5, 0.11, 0.1) });
    const c = photo({ id: 'c', colourGrid: grid(0.5, 0.1, 0.11) });
    assert.equal(groupOutliers([a, b, c]).size, 0);
  });

  it('is well-defined, not NaN, when every reference is colour-identical', () => {
    const same = () => photo({ colourGrid: grid(0.5, 0.2, 0.2) });
    const distances = groupColourDistances([same(), same(), same()]);
    for (const d of distances.values()) assert.equal(d, 0);
    assert.equal(groupOutliers([same(), same(), same()]).size, 0);
  });

  it('ignores refs with no colour grid entirely rather than counting them as agreeing at distance 0', () => {
    const a = photo({ id: 'a', colourGrid: grid(0.5, 0.1, 0.1) });
    const b = photo({ id: 'b', colourGrid: grid(0.5, 0.11, 0.1) });
    const c = photo({ id: 'c', colourGrid: grid(0.5, 0.1, 0.11) });
    const noGrid = photo({ id: 'no-grid', colourGrid: undefined });
    const distances = groupColourDistances([a, b, c, noGrid]);
    assert.ok(!distances.has('no-grid'));
    assert.equal(distances.size, 3);
  });
});
