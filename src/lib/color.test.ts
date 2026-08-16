/**
 * Tests for the colour pipeline: sRGB -> OKLCH, and the fixed hue anchors that
 * turn an OKLCH value into a chapter key.
 *
 * The two halves are tested differently on purpose. The colour science is
 * physics with known answers — pure red really does sit near hue 29°, so the
 * tests check the maths against that external fact rather than against
 * whatever the code happens to currently output. The chapter binning is a
 * design decision — fixed anchors, `<`/`>=` band edges, key strings that
 * survive a round trip — and what matters there is that the decision, once
 * made, cannot silently drift: a photo filed under "red-deep" today must
 * still resolve to deep/red a decade from now, however the archive grows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACHROMATIC_CHROMA,
  ACHROMATIC_KEY,
  baseKeyOf,
  bandOf,
  chapterKey,
  chapterName,
  chapterRank,
  classify,
  defaultChapterName,
  keyToHue,
  lightnessBand,
  linearRgbToOklab,
  nearestAnchor,
  oklchCss,
  roundOklch,
  srgb255ToOklch,
  type Band,
  type OKLCH,
} from './color.ts';

const closeTo = (actual: number, expected: number, tolerance: number, msg?: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, msg ?? `${actual} not within ${tolerance} of ${expected}`);

/* ── sRGB -> linear -> OKLab ──────────────────────────────────────────────── */

describe('linearRgbToOklab', () => {
  it('gives grey zero chroma, because the matrices are built to cancel a=b=0 there', () => {
    // Row sums of both chromatic-axis matrices are ~0 for equal inputs, which
    // is the whole reason a photograph with r=g=b reads as perfectly neutral
    // instead of picking up a phantom cast from matrix rounding.
    for (const x of [0, 0.1, 0.5, 0.9, 1]) {
      const [, a, b] = linearRgbToOklab(x, x, x);
      closeTo(a, 0, 1e-6, `a was ${a} for x=${x}`);
      closeTo(b, 0, 1e-6, `b was ${b} for x=${x}`);
    }
  });

  it('maps equal linear channels to L = cbrt(x), the other row sum being ~1', () => {
    for (const x of [0.1, 0.2, 0.5, 0.8]) {
      const [L] = linearRgbToOklab(x, x, x);
      closeTo(L, Math.cbrt(x), 1e-6, `L was ${L} for x=${x}`);
    }
  });

  it('maps pure black to the origin', () => {
    assert.deepEqual(linearRgbToOklab(0, 0, 0), [0, 0, 0]);
  });
});

/* ── sRGB 0..255 -> OKLCH ─────────────────────────────────────────────────── */

describe('srgb255ToOklch', () => {
  it('composes the sRGB decode, linearRgbToOklab, and rectangular-to-polar exactly', () => {
    // Reimplementing the sRGB EOTF (standard, not the code under test) lets us
    // check the wiring — decode -> OKLab -> polar — without duplicating the
    // OKLab matrices themselves.
    const decode = (c: number): number => {
      const x = c / 255;
      return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    for (const [r, g, b] of [[255, 128, 0], [12, 200, 240], [0, 0, 0], [255, 255, 255]] as const) {
      const [L, a, bb] = linearRgbToOklab(decode(r), decode(g), decode(b));
      const C = Math.sqrt(a * a + bb * bb);
      let H = (Math.atan2(bb, a) * 180) / Math.PI;
      if (H < 0) H += 360;
      const got = srgb255ToOklch(r, g, b);
      assert.equal(got.L, L);
      assert.equal(got.C, C);
      assert.equal(got.H, H);
    }
  });

  it('gives pure black L=0, C=0, H=0 exactly — no floating-point noise when the input is all zero', () => {
    assert.deepEqual(srgb255ToOklch(0, 0, 0), { L: 0, C: 0, H: 0 });
  });

  it('gives pure white L≈1 and C≈0', () => {
    const white = srgb255ToOklch(255, 255, 255);
    closeTo(white.L, 1, 1e-5);
    closeTo(white.C, 0, 1e-6);
    // H is meaningless at zero chroma — a grey pixel has no hue to speak of —
    // so we deliberately do not assert a value for it here.
  });

  it('lands the saturated primaries near their well-known OKLCH hues', () => {
    // These are the textbook OKLCH angles for sRGB primaries, and they are
    // *why* the chapter anchors sit where they do (red at 28°, green at 145°,
    // blue at 255° in ANCHORS) — a photo of a red barn should file under "red"
    // precisely because pure red lands here.
    const red = srgb255ToOklch(255, 0, 0);
    closeTo(red.H, 29, 3, `red hue was ${red.H}`);
    assert.equal(nearestAnchor(red.H).slug, 'red');

    const green = srgb255ToOklch(0, 255, 0);
    closeTo(green.H, 142, 5, `green hue was ${green.H}`);
    assert.equal(nearestAnchor(green.H).slug, 'green');

    const blue = srgb255ToOklch(0, 0, 255);
    closeTo(blue.H, 264, 6, `blue hue was ${blue.H}`);
    assert.equal(nearestAnchor(blue.H).slug, 'blue');

    // All three are strongly saturated, not borderline achromatic.
    for (const c of [red.C, green.C, blue.C]) assert.ok(c > 0.2, `chroma ${c} was not saturated`);
  });
});

/* ── Nearest anchor: circular hue distance ───────────────────────────────── */

describe('nearestAnchor', () => {
  it('resolves exactly to the anchor sitting at that hue', () => {
    for (const [slug, H] of [
      ['red', 28], ['orange', 62], ['yellow', 100], ['green', 145],
      ['teal', 195], ['blue', 255], ['violet', 305], ['magenta', 350],
    ] as const) {
      assert.equal(nearestAnchor(H).slug, slug);
    }
  });

  it('wraps around 0/360 instead of measuring linear distance', () => {
    // 359° is 9° from magenta (350°) going forward, but 331° from red (28°)
    // the "long way" and only 29° from red going backward through 0. Circular
    // distance must compare 9 against 29 — magenta wins — not treat 331 as
    // the honest gap to red.
    assert.equal(nearestAnchor(359).slug, 'magenta');
    assert.equal(nearestAnchor(1).slug, 'magenta');

    // 15° sits between magenta (350°, circular distance 25°) and red (28°,
    // distance 13°) when the wrap through 0 is accounted for. Red is nearer.
    assert.equal(nearestAnchor(15).slug, 'red');
  });

  it('splits the boundary between magenta and red at their circular midpoint, 9°', () => {
    // Circular midpoint of 350° and 28° (the short way, through 0) is 369°/2
    // = 9°, not the naive linear midpoint 189°.
    assert.equal(nearestAnchor(9.001).slug, 'red');
    assert.equal(nearestAnchor(8.999).slug, 'magenta');
    assert.equal(nearestAnchor(0).slug, 'magenta');
  });
});

/* ── Lightness bands ──────────────────────────────────────────────────────── */

describe('lightnessBand', () => {
  it('is deep strictly below 0.45', () => {
    assert.equal(lightnessBand(0.449999), 'deep');
    assert.equal(lightnessBand(0.45), 'mid');
  });

  it('is pale at 0.72 and above', () => {
    assert.equal(lightnessBand(0.719999), 'mid');
    assert.equal(lightnessBand(0.72), 'pale');
  });

  it('is mid in between', () => {
    assert.equal(lightnessBand(0.6), 'mid');
  });
});

/* ── Chapter key composition ──────────────────────────────────────────────── */

describe('chapterKey / baseKeyOf / bandOf', () => {
  const bands: Band[] = ['deep', 'mid', 'pale'];
  const bases = ['red', 'achromatic', 'blue-ish', 'a-deep-name', 'a-pale-name'];

  it('round-trips band through chapterKey -> bandOf for every base and band', () => {
    for (const base of bases) {
      for (const band of bands) {
        assert.equal(bandOf(chapterKey(base, band)), band, `base=${base} band=${band}`);
      }
    }
  });

  it('round-trips the base through chapterKey -> baseKeyOf for every band', () => {
    for (const base of bases) {
      for (const band of bands) {
        assert.equal(baseKeyOf(chapterKey(base, band)), base, `base=${base} band=${band}`);
      }
    }
  });

  it('leaves mid unsuffixed — chapterKey(base, "mid") is the bare base', () => {
    assert.equal(chapterKey('red', 'mid'), 'red');
    assert.equal(chapterKey('achromatic', 'mid'), 'achromatic');
  });

  it('strips only the trailing suffix, not one buried in the base itself', () => {
    // A base slug that happens to already look like it ends in "-deep" must
    // not confuse baseKeyOf/bandOf about which suffix is the real one.
    const key = chapterKey('deep-red', 'deep'); // "deep-red-deep"
    assert.equal(key, 'deep-red-deep');
    assert.equal(bandOf(key), 'deep');
    assert.equal(baseKeyOf(key), 'deep-red');

    const key2 = chapterKey('pale-blue', 'pale'); // "pale-blue-pale"
    assert.equal(bandOf(key2), 'pale');
    assert.equal(baseKeyOf(key2), 'pale-blue');
  });

  it('treats a key with no recognised suffix as mid', () => {
    assert.equal(bandOf('teal'), 'mid');
    assert.equal(baseKeyOf('teal'), 'teal');
  });
});

/* ── Chapter ordering ─────────────────────────────────────────────────────── */

describe('chapterRank', () => {
  it('ranks achromatic, in every band, below every hued chapter', () => {
    const achromaticRanks = (['deep', 'mid', 'pale'] as Band[]).map((band) =>
      chapterRank(chapterKey(ACHROMATIC_KEY, band)),
    );
    const huedRanks = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'magenta']
      .flatMap((slug) => (['deep', 'mid', 'pale'] as Band[]).map((band) => chapterRank(chapterKey(slug, band))));
    for (const a of achromaticRanks) {
      for (const h of huedRanks) assert.ok(a < h, `achromatic rank ${a} was not below hued rank ${h}`);
    }
  });

  it('orders deep < mid < pale within one base hue', () => {
    for (const base of ['red', 'teal', 'magenta']) {
      const deep = chapterRank(chapterKey(base, 'deep'));
      const mid = chapterRank(chapterKey(base, 'mid'));
      const pale = chapterRank(chapterKey(base, 'pale'));
      assert.ok(deep < mid && mid < pale, `${base}: ${deep} < ${mid} < ${pale} failed`);
    }
  });

  it('orders the hued chapters around the wheel in the order the anchors were declared', () => {
    const wheel = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'magenta'];
    const ranks = wheel.map((slug) => chapterRank(slug));
    for (let i = 1; i < ranks.length; i++) {
      assert.ok(ranks[i] > ranks[i - 1], `${wheel[i]} (${ranks[i]}) did not rank after ${wheel[i - 1]} (${ranks[i - 1]})`);
    }
  });

  it('keyToHue is an alias of chapterRank', () => {
    for (const key of ['red', 'red-deep', 'achromatic', 'blue-pale']) {
      assert.equal(keyToHue(key), chapterRank(key));
    }
  });
});

/* ── Chapter names ────────────────────────────────────────────────────────── */

describe('defaultChapterName', () => {
  it('gives achromatic its special names per band', () => {
    assert.equal(defaultChapterName('achromatic'), 'Ash');
    assert.equal(defaultChapterName('achromatic-deep'), 'Charcoal');
    assert.equal(defaultChapterName('achromatic-pale'), 'Silver');
  });

  it('uses the bare anchor name for a hued mid band', () => {
    assert.equal(defaultChapterName('red'), 'Red');
    assert.equal(defaultChapterName('teal'), 'Teal');
  });

  it('prefixes Deep/Pale onto a hued chapter name', () => {
    assert.equal(defaultChapterName('red-deep'), 'Deep Red');
    assert.equal(defaultChapterName('red-pale'), 'Pale Red');
  });
});

describe('chapterName', () => {
  it('renames the base but keeps the deep/pale prefix', () => {
    assert.equal(chapterName('orange', 'Camel'), 'Camel');
    assert.equal(chapterName('orange-deep', 'Camel'), 'Deep Camel');
    assert.equal(chapterName('orange-pale', 'Camel'), 'Pale Camel');
  });

  it('falls back to the default name when no override is given', () => {
    assert.equal(chapterName('red-deep'), defaultChapterName('red-deep'));
    assert.equal(chapterName('red-deep', undefined), defaultChapterName('red-deep'));
  });

  it('ignores an override for achromatic entirely — never renamed', () => {
    assert.equal(chapterName('achromatic', 'Anything'), 'Ash');
    assert.equal(chapterName('achromatic-deep', 'Anything'), 'Charcoal');
    assert.equal(chapterName('achromatic-pale', 'Anything'), 'Silver');
  });
});

/* ── Classification ───────────────────────────────────────────────────────── */

describe('classify', () => {
  it('is achromatic for any hue once chroma drops below the threshold', () => {
    for (const H of [0, 90, 180, 270, 359]) {
      const result = classify({ L: 0.5, C: ACHROMATIC_CHROMA - 0.0001, H });
      assert.equal(result.chapter, ACHROMATIC_KEY, `H=${H}`);
    }
  });

  it('is exactly at the threshold still counted as chromatic — the check is strict <', () => {
    const atThreshold = classify({ L: 0.5, C: ACHROMATIC_CHROMA, H: 100 });
    assert.equal(atThreshold.chapter, nearestAnchor(100).slug);
    assert.notEqual(atThreshold.chapter, ACHROMATIC_KEY);
  });

  it('resolves to the nearest anchor slug once chroma clears the threshold', () => {
    for (const H of [28, 62, 100, 145, 195, 255, 305, 350]) {
      const result = classify({ L: 0.5, C: 0.1, H });
      assert.equal(result.chapter, nearestAnchor(H).slug);
    }
  });

  it('carries the original oklch value through unchanged', () => {
    const oklch: OKLCH = { L: 0.42, C: 0.2, H: 88 };
    assert.deepEqual(classify(oklch).oklch, oklch);
  });
});

/* ── Rounding and CSS formatting ──────────────────────────────────────────── */

describe('roundOklch', () => {
  it('rounds L and C to 3 decimals, H to 1', () => {
    assert.deepEqual(roundOklch({ L: 0.123449, C: 0.123449, H: 12.34 }), { L: 0.123, C: 0.123, H: 12.3 });
  });

  it('rounds halves the way Math.round does — up, not banker\'s rounding', () => {
    assert.deepEqual(roundOklch({ L: 0.1235, C: 0.0005, H: 12.35 }), { L: 0.124, C: 0.001, H: 12.4 });
  });

  it('is idempotent on already-rounded values', () => {
    const o = { L: 0.5, C: 0.1, H: 200 };
    assert.deepEqual(roundOklch(o), roundOklch(roundOklch(o)));
  });
});

describe('oklchCss', () => {
  it('formats L/C/H to 3/3/1 decimals with no alpha segment by default', () => {
    assert.equal(oklchCss({ L: 0.5, C: 0.1, H: 200 }), 'oklch(0.500 0.100 200.0)');
  });

  it('omits the alpha segment when alpha is explicitly 1', () => {
    assert.equal(oklchCss({ L: 0.5, C: 0.1, H: 200 }, 1), 'oklch(0.500 0.100 200.0)');
  });

  it('includes " / alpha" when alpha is not 1', () => {
    assert.equal(oklchCss({ L: 0.5, C: 0.1, H: 200 }, 0.5), 'oklch(0.500 0.100 200.0 / 0.5)');
  });
});
