/**
 * Tests for the chapter photo-ordering in manifest.ts.
 *
 * `orderByChapterStrength` replaced a shortest-path ("smoothest walk between
 * neighbours") algorithm with a ranking against the chapter's own mean
 * colour — see the header comment above it in manifest.ts for why. What's
 * worth proving here: the ranking rewards both chroma AND hue alignment
 * together (not either alone), handles a hue opposite the chapter's own
 * (a real possibility, not just a theoretical edge), is deterministic on
 * ties, and treats an achromatic chapter's "colour strength" as the
 * opposite question (purest grey first) rather than nonsense from dividing
 * by a near-zero chroma.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { orderByChapterStrength } from './manifest.ts';
import { ACHROMATIC_CHROMA } from './color.ts';
import type { OKLCH } from './color.ts';
import type { Photo } from './types.ts';

let n = 0;
/** A Photo with only the field this ordering reads — oklch — set to
 *  anything meaningful; everything else the interface demands is
 *  irrelevant to a pure colour ranking. */
const photo = (oklch: OKLCH, id?: string): Photo =>
  ({
    id: id ?? `p${n++}`,
    filename: 'x.jpg',
    ext: 'jpg',
    width: 1,
    height: 1,
    bytes: 1,
    oklch,
    autoChapter: 'x',
    chapter: 'x',
    autoMedium: 'digital',
    medium: 'digital',
    placeholder: '',
    derivatives: [],
    exif: {},
    addedAt: new Date().toISOString(),
  }) as unknown as Photo;

const RED_MEAN: OKLCH = { L: 0.6, C: 0.15, H: 30 };

describe('orderByChapterStrength', () => {
  it('ranks higher chroma at the chapter\'s own hue above lower chroma at the same hue', () => {
    const strong = photo({ L: 0.6, C: 0.2, H: 30 }, 'strong');
    const weak = photo({ L: 0.6, C: 0.05, H: 30 }, 'weak');
    const order = orderByChapterStrength([weak, strong], RED_MEAN);
    assert.deepEqual(order.map((p) => p.id), ['strong', 'weak']);
  });

  it('ranks a photo at the chapter\'s own hue above an equally-saturated photo at a different hue', () => {
    // Same chroma (0.2) as each other — only hue alignment with the
    // chapter's own mean (30°) should decide the order.
    const onHue = photo({ L: 0.6, C: 0.2, H: 30 }, 'on-hue');
    const offHue = photo({ L: 0.6, C: 0.2, H: 120 }, 'off-hue');
    const order = orderByChapterStrength([offHue, onHue], RED_MEAN);
    assert.deepEqual(order.map((p) => p.id), ['on-hue', 'off-hue']);
  });

  it('a photo at the opposite hue scores below a grey (zero-chroma) photo, not just lower', () => {
    // 180° from the chapter's own hue: this photo's colour actively works
    // against what the chapter is, which is a stronger claim than "muted".
    const opposite = photo({ L: 0.6, C: 0.15, H: 210 }, 'opposite');
    const grey = photo({ L: 0.6, C: 0, H: 0 }, 'grey');
    const order = orderByChapterStrength([opposite, grey], RED_MEAN);
    assert.deepEqual(order.map((p) => p.id), ['grey', 'opposite']);
  });

  it('breaks an exact tie by id, so the order is reproducible rather than input-order-dependent', () => {
    const a = photo({ L: 0.6, C: 0.15, H: 30 }, 'b-photo');
    const b = photo({ L: 0.6, C: 0.15, H: 30 }, 'a-photo');
    // Fed in one order...
    const order1 = orderByChapterStrength([a, b], RED_MEAN).map((p) => p.id);
    // ...and the reverse — the result must be identical either way.
    const order2 = orderByChapterStrength([b, a], RED_MEAN).map((p) => p.id);
    assert.deepEqual(order1, ['a-photo', 'b-photo']);
    assert.deepEqual(order2, ['a-photo', 'b-photo']);
  });

  it('orders an achromatic chapter by chroma ascending — purest grey first, not a hue projection', () => {
    const greyMean: OKLCH = { L: 0.5, C: ACHROMATIC_CHROMA / 4, H: 0 };
    const purer = photo({ L: 0.5, C: 0.01, H: 200 }, 'purer');
    const tinted = photo({ L: 0.5, C: 0.03, H: 200 }, 'tinted');
    const order = orderByChapterStrength([tinted, purer], greyMean);
    assert.deepEqual(order.map((p) => p.id), ['purer', 'tinted']);
  });

  it('does not divide by zero for a chapter mean that is exactly achromatic', () => {
    const zeroMean: OKLCH = { L: 0.5, C: 0, H: 0 };
    const a = photo({ L: 0.5, C: 0.01, H: 10 }, 'a');
    const b = photo({ L: 0.5, C: 0.02, H: 10 }, 'b');
    const order = orderByChapterStrength([b, a], zeroMean);
    assert.deepEqual(order.map((p) => p.id), ['a', 'b']);
    assert.ok(order.every((p) => Number.isFinite(p.oklch.C)));
  });

  it('returns a single photo, or an empty list, unchanged', () => {
    const only = photo({ L: 0.5, C: 0.1, H: 30 });
    assert.deepEqual(orderByChapterStrength([only], RED_MEAN), [only]);
    assert.deepEqual(orderByChapterStrength([], RED_MEAN), []);
  });

  it('never mutates the input array', () => {
    const a = photo({ L: 0.6, C: 0.05, H: 30 }, 'a');
    const b = photo({ L: 0.6, C: 0.2, H: 30 }, 'b');
    const input = [a, b];
    orderByChapterStrength(input, RED_MEAN);
    assert.deepEqual(input, [a, b], 'input order must be untouched');
  });
});
